import { Part } from '@google/genai';
import { ClothingItem } from '@prisma/client';
import { sendEvent, handleStreamError } from '@/server/utils/stream-helpers';
import type { UserProfileResult } from '@/server/agents/user-profile';
import type { StylistResult } from '@/server/agents/stylist';
import type { GatekeeperIntent } from '@/server/agents/intent';
import {
  logRequestAudit,
  RequestAuditKind,
  RequestAuditOutcome,
  RequestAuditRoute,
  RequestTrace,
} from '@/server/logging/request';
import { runWithRequestTrace } from '@/server/logging/usageContext';
import { buildContext } from './context/buildContext';
import {
  applyImageResultsToText,
  extractStylistCache,
  StylistCacheNode,
  WardrobeCandidatesNode,
} from '@/server/utils/messageContent';
import { getProfileLocation, persistMessageContent } from './helpers';
import { outfitCachePipeline, outfitFreshPipeline } from './graph/outfitPipeline';
import {
  buildPipelineInvokeConfig,
  logLangSmithStatusOnce,
} from './graph/langsmith';
import type { OutfitRuntime } from './graph/state';
import {
  registerInFlight,
  unregisterInFlight,
} from '@/server/lifecycle/shutdown';
import { isAbortError } from '@/server/utils/abort';
import prismadb from '@/server/db';

export { createImageRetryStream } from './imageRetry';

export interface MultiAgentStreamOptions {
  clientIp?: string;
  currentImageUrl?: string;
  currentImageUrls?: string[];
}

function createRuntime(params: {
  controller: ReadableStreamDefaultController;
  initialParts: Part[];
  clientId?: string;
  conversationId?: string;
  messageId?: string;
  clientIp?: string;
  currentImageUrl?: string;
  currentImageUrls?: string[];
  profileLocationPromise: Promise<string | undefined>;
  trace: RequestTrace;
  abortSignal: AbortSignal;
}): {
  runtime: OutfitRuntime;
  getSnapshot: () => {
    messageId?: string;
    accumulatedContent: string;
    stylistCacheNode: StylistCacheNode | null;
    activeStylistResult: StylistResult | null;
    wardrobeCandidatesNode: WardrobeCandidatesNode | null;
  };
} {
  let messageId = params.messageId;
  let accumulatedContent = '';
  let stylistCacheNode: StylistCacheNode | null = null;
  let activeStylistResult: StylistResult | null = null;
  let wardrobeCandidatesNode: WardrobeCandidatesNode | null = null;
  let activeIntent: GatekeeperIntent | undefined;

  const imageMap = new Map<string, string>();
  const failedImageIds = new Set<string>();
  const ragCache = new Map<string, ClothingItem>();

  const runtime: OutfitRuntime = {
    controller: params.controller,
    imageMap,
    failedImageIds,
    ragCache,
    initialParts: params.initialParts,
    clientId: params.clientId,
    conversationId: params.conversationId,
    clientIp: params.clientIp,
    currentImageUrl: params.currentImageUrl,
    currentImageUrls: params.currentImageUrls,
    profileLocationPromise: params.profileLocationPromise,
    trace: params.trace,
    abortSignal: params.abortSignal,
    appendText: (text) => {
      accumulatedContent += text;
    },
    getAccumulated: () => accumulatedContent,
    setMessageId: (id) => {
      messageId = id;
      params.trace.setMessageId(id);
    },
    getMessageId: () => messageId,
    setStylistCache: (value) => {
      stylistCacheNode = value;
    },
    getStylistCache: () => stylistCacheNode,
    setActiveStylist: (value) => {
      activeStylistResult = value;
    },
    getActiveStylist: () => activeStylistResult,
    setWardrobeCandidates: (value) => {
      wardrobeCandidatesNode = value;
    },
    getWardrobeCandidates: () => wardrobeCandidatesNode,
    setActiveIntent: (value) => {
      activeIntent = value;
    },
    getActiveIntent: () => activeIntent,
  };

  return {
    runtime,
    getSnapshot: () => ({
      messageId,
      accumulatedContent,
      stylistCacheNode,
      activeStylistResult,
      wardrobeCandidatesNode,
    }),
  };
}

export function createMultiAgentStream(
  initialParts: Part[],
  clientId?: string,
  conversationId?: string,
  messageId?: string,
  options: MultiAgentStreamOptions = {}
): ReadableStream {
  const trace = new RequestTrace({
    kind: RequestAuditKind.Generate,
    conversationId,
    messageId,
    clientId,
  });

  const abortController = new AbortController();
  const inFlightId = crypto.randomUUID();
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  registerInFlight(inFlightId, abortController, done);

  return new ReadableStream({
    async start(controller) {
      await runWithRequestTrace(trace, async () => {
      console.log('[ORCHESTRATOR:LANGGRAPH] --- 启动 Multi-Agent 编排流 ---');
      logLangSmithStatusOnce();

      const profileLocationPromise = getProfileLocation(clientId);
      const { runtime, getSnapshot } = createRuntime({
        controller,
        initialParts,
        clientId,
        conversationId,
        messageId,
        clientIp: options.clientIp,
        currentImageUrl: options.currentImageUrl,
        currentImageUrls: options.currentImageUrls,
        profileLocationPromise,
        trace,
        abortSignal: abortController.signal,
      });

      let mainError: Error | null = null;

      try {
        const { historyForAI, failedMessage, sessionItems } = await buildContext(
          conversationId,
          runtime.getMessageId(),
          options.currentImageUrls ?? options.currentImageUrl
        );

        let cachedStylistResult: StylistResult | null = null;
        let cachedProfile: UserProfileResult | null = null;

        if (failedMessage) {
          const cacheFromMessage = extractStylistCache(failedMessage.content);
          if (cacheFromMessage) {
            console.log(
              '[ORCHESTRATOR:LANGGRAPH] 发现搭配师方案缓存，启动【断点续传】优化！'
            );
            runtime.setStylistCache(cacheFromMessage);
            cachedStylistResult = cacheFromMessage.stylist_result;
            cachedProfile = cacheFromMessage.user_profile;
            for (const item of cacheFromMessage.wardrobe_items ?? []) {
              runtime.ragCache.set(item.id, item);
            }
          }
        }

        if (cachedStylistResult && cachedProfile) {
          runtime.setActiveStylist(cachedStylistResult);
          runtime.trace.setRoute(RequestAuditRoute.FromCache);
          await outfitCachePipeline.invoke(
            {
              history: historyForAI,
              sessionItems,
              cacheHit: true,
              route: 'from_cache',
              messageId: runtime.getMessageId(),
              stylistResult: cachedStylistResult,
              userProfile: cachedProfile,
              cachedPersonalStyle: cachedProfile.personal_style,
            },
            buildPipelineInvokeConfig({
              runtime,
              pipeline: 'outfit_cache',
              conversationId,
              clientId,
              messageId: runtime.getMessageId(),
            })
          );
        } else {
          await outfitFreshPipeline.invoke(
            {
              history: historyForAI,
              sessionItems,
              cacheHit: false,
              messageId: runtime.getMessageId(),
            },
            buildPipelineInvokeConfig({
              runtime,
              pipeline: 'outfit_fresh',
              conversationId,
              clientId,
              messageId: runtime.getMessageId(),
            })
          );
        }
      } catch (error) {
        mainError = error instanceof Error ? error : new Error(String(error));
        console.error(
          '[ORCHESTRATOR:LANGGRAPH] 编排流运行中发生错误:',
          mainError.message,
          mainError.stack
        );
      } finally {
        const snapshot = getSnapshot();
        let stylistCacheNode = snapshot.stylistCacheNode;
        const { activeStylistResult, wardrobeCandidatesNode } = snapshot;
        const finalMessageId = snapshot.messageId;
        const accumulatedContent = snapshot.accumulatedContent;
        const aborted =
          abortController.signal.aborted ||
          (mainError != null && isAbortError(mainError));
        const failed = Boolean(mainError) || aborted;

        if (aborted) {
          trace.markCancelled(abortController.signal.reason ?? mainError?.message ?? 'aborted');
        }

        if (finalMessageId) {
          try {
            const finalContent = applyImageResultsToText(
              accumulatedContent,
              runtime.imageMap
            );

            if (!stylistCacheNode) {
              const existing = await prismadb.message.findUnique({
                where: { id: finalMessageId },
                select: { content: true },
              });
              stylistCacheNode = extractStylistCache(existing?.content ?? null);
            }

            const outfitIds =
              activeStylistResult?.outfits.map((o) => o.id) ??
              stylistCacheNode?.stylist_result.outfits.map((o) => o.id) ??
              [];

            await persistMessageContent(finalMessageId, {
              text: finalContent,
              stylistCache: stylistCacheNode,
              imageMap: runtime.imageMap,
              failedImageIds: runtime.failedImageIds,
              outfitIds,
              status: failed ? 'failed' : 'completed',
              wardrobeCandidates: wardrobeCandidatesNode,
            });
            console.log(
              `[ORCHESTRATOR:LANGGRAPH] 数据库记录 ${finalMessageId} 已更新，状态: ${
                failed ? 'failed' : 'completed'
              }`
            );
          } catch (dbError) {
            console.error('[ORCHESTRATOR:LANGGRAPH] 更新数据库最终状态失败:', dbError);
          }
        }

        const activeIntent = runtime.getActiveIntent();
        if (activeIntent?.request_type) {
          runtime.trace.setRequestType(activeIntent.request_type);
        }

        void logRequestAudit(
          runtime.trace.finalize({
            outcome: failed ? RequestAuditOutcome.Failed : RequestAuditOutcome.Completed,
            errorMessage: mainError?.message,
            messageId: finalMessageId,
            summary: {
              outfitCount:
                activeStylistResult?.outfits.length ??
                stylistCacheNode?.stylist_result.outfits.length,
              imageSuccessCount: runtime.imageMap.size,
              imageFailedCount: runtime.failedImageIds.size,
              ragItemCount: runtime.ragCache.size,
              wardrobeCandidateCount: wardrobeCandidatesNode?.items.length,
            },
          })
        );

        if (mainError && !aborted) {
          handleStreamError(controller, [], mainError, 'OrchestratorProcess');
        } else if (!failed) {
          sendEvent(controller, 'stream_end', { message: '所有内容已加载完毕' });
          try {
            controller.close();
          } catch (e) {
            console.warn(
              '[ORCHESTRATOR:LANGGRAPH] 流控制器关闭失败 (可能已被客户端取消):',
              e
            );
          }
        }

        resolveDone();
        unregisterInFlight(inFlightId);
      }
      });
    },
    cancel(reason) {
      console.warn('[ORCHESTRATOR:LANGGRAPH] 流被客户端取消，原因:', reason);
      trace.markCancelled(reason);
      if (!abortController.signal.aborted) {
        abortController.abort(reason ?? new DOMException('Client cancelled', 'AbortError'));
      }
    },
  });
}
