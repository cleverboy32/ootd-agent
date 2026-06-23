import { Part } from '@google/genai';
import { ClothingItem, Prisma } from '@prisma/client';
import prismadb from '@/server/db';
import { sendEvent, handleStreamError } from '@/server/utils/stream-helpers';

import { callGatekeeperAgent, GatekeeperContext, GatekeeperResult } from './handlers/gatekeeperAgent';
import { callUserProfileAgent, buildUserProfileFallback, UserProfileResult, shouldSkipProfileAgentUpdate, loadUserProfileFromDb } from './handlers/userProfileAgent';
import { callStylistAgent, callStylistAdvice, StylistOutfit, StylistResult } from './handlers/stylistAgent';
import { callCopywriterAgentStream, callCopywriterAdviceStream, CopywriterAuditMeta } from './handlers/copywriterAgent';
import { callVisualDirectorAgent } from '@/server/services/visualDirectorService';
import { AnchorItemImageData, GatekeeperIntent } from './handlers/intentTypes';
import { buildContext } from './handlers/buildContext';
import { IMAGE_GEN_CONCURRENCY } from '@/server/config/models';
import { mapWithConcurrency } from '@/server/utils/concurrency';
import {
  applyImageResultsToText,
  buildImageStates,
  buildPersistedMessageContent,
  extractStylistCache,
  extractImageStates,
  extractTextContent,
  patchMessageImageResult,
  WardrobeCandidatesNode,
  StylistCacheNode,
} from '@/server/utils/messageContent';

async function runOutfitImageGeneration(
  outfit: StylistOutfit,
  wardrobeUrls: string[],
  anchorImageData: AnchorItemImageData | undefined,
  controller: ReadableStreamDefaultController,
  imageMap: Map<string, string>,
  failedImageIds: Set<string>,
  messageId?: string,
  trigger: 'initial' | 'user_retry' = 'initial'
): Promise<void> {
  const imageId = outfit.id;

  try {
    await callVisualDirectorAgent(
      controller,
      outfit,
      wardrobeUrls,
      anchorImageData,
      imageId,
      (id, url) => {
        imageMap.set(id, url);
        console.log(`[ORCHESTRATOR] 效果图生成成功: ${id} -> ${url}`);
      },
      { trigger, messageId }
    );
  } catch (e) {
    failedImageIds.add(outfit.id);
    console.warn(`[ORCHESTRATOR] 方案 ${outfit.id} 效果图生成失败 (已优雅降级):`, e);
    sendEvent(controller, 'image_generation_failed', {
      id: outfit.id,
      message: e instanceof Error ? e.message : '效果图生成失败',
      alt: outfit.overall_concept,
    });
  }
}

/**
 * 公共执行链：并行启动文案流与视觉导演画图流，并在内部统一 Await 和进行致命错误判定
 */
async function executeParallelAgents(
  stylistResult: StylistResult,
  personalStyle: string,
  ragCache: Map<string, ClothingItem>,
  controller: ReadableStreamDefaultController,
  imageMap: Map<string, string>,
  failedImageIds: Set<string>,
  onText: (text: string) => void,
  auditMeta?: CopywriterAuditMeta,
  intent?: GatekeeperIntent,
  revisionNoItemChange?: boolean
): Promise<void> {
  console.log('[ORCHESTRATOR] 启动并行双轨执行链 (文案流 + 视觉导演并行画图)...');

  const copywriterPromise = callCopywriterAgentStream(
    stylistResult,
    personalStyle,
    controller,
    onText,
    auditMeta,
    intent,
    revisionNoItemChange
  );

  const wardrobeUrls = Array.from(ragCache.values())
    .map((item) => item.imageUrl)
    .filter((url): url is string => !!url);

  const imageTask = mapWithConcurrency(
    stylistResult.outfits,
    IMAGE_GEN_CONCURRENCY,
    (outfit) =>
      runOutfitImageGeneration(
        outfit,
        wardrobeUrls,
        stylistResult.anchor_item_image_data,
        controller,
        imageMap,
        failedImageIds,
        auditMeta?.messageId,
        'initial'
      )
  );

  const [copywriterRes] = await Promise.allSettled([copywriterPromise, imageTask]);

  if (copywriterRes.status === 'rejected') {
    throw new Error(`CopywriterFailed: ${copywriterRes.reason?.message || '文案生成失败'}`);
  }
}

async function persistMessageContent(
  messageId: string,
  options: {
    text: string;
    stylistCache: StylistCacheNode | null;
    imageMap: Map<string, string>;
    failedImageIds: Set<string>;
    outfitIds: string[];
    status: 'completed' | 'failed' | 'generating';
    wardrobeCandidates?: WardrobeCandidatesNode | null;
  }
): Promise<void> {
  const imageStates = buildImageStates(options.outfitIds, options.imageMap, options.failedImageIds);
  const content = buildPersistedMessageContent({
    text: options.text,
    stylistCache: options.stylistCache,
    imageStates,
    wardrobeCandidates: options.wardrobeCandidates,
  });

  await prismadb.message.update({
    where: { id: messageId },
    data: {
      content: content as Prisma.InputJsonValue,
      status: options.status,
    },
  });
}

/** 单张效果图用户重试：仅重跑 VisualDirector，复用 stylist_cache */
export function createImageRetryStream(
  conversationId: string,
  messageId: string,
  retryOutfitId: string
): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      console.log(`[ORCHESTRATOR] --- 单图重试: message=${messageId} outfit=${retryOutfitId} ---`);

      try {
        const message = await prismadb.message.findUnique({ where: { id: messageId } });
        if (!message) {
          throw new Error('Message not found');
        }

        const stylistCache = extractStylistCache(message.content);
        if (!stylistCache) {
          throw new Error('No stylist cache found for this message. Please retry the full message.');
        }

        const outfit = stylistCache.stylist_result.outfits.find((o) => o.id === retryOutfitId);
        if (!outfit) {
          throw new Error(`Outfit ${retryOutfitId} not found in stylist cache`);
        }

        const ragCache = new Map<string, ClothingItem>();
        for (const item of stylistCache.wardrobe_items ?? []) {
          ragCache.set(item.id, item);
        }

        const wardrobeUrls = Array.from(ragCache.values())
          .map((item) => item.imageUrl)
          .filter((url): url is string => !!url);

        const imageMap = new Map<string, string>();
        const failedImageIds = new Set<string>();

        await runOutfitImageGeneration(
          outfit,
          wardrobeUrls,
          stylistCache.stylist_result.anchor_item_image_data,
          controller,
          imageMap,
          failedImageIds,
          messageId,
          'user_retry'
        );

        if (imageMap.has(retryOutfitId)) {
          const url = imageMap.get(retryOutfitId)!;
          const updatedContent = patchMessageImageResult(message.content, retryOutfitId, url);
          await prismadb.message.update({
            where: { id: messageId },
            data: { content: updatedContent as Prisma.InputJsonValue },
          });
        } else {
          const existingStates = extractImageStates(message.content);
          await prismadb.message.update({
            where: { id: messageId },
            data: {
              content: buildPersistedMessageContent({
                text: extractTextContent(message.content),
                stylistCache,
                imageStates: { ...existingStates, [retryOutfitId]: 'failed' },
              }) as Prisma.InputJsonValue,
            },
          });
        }

        sendEvent(controller, 'stream_end', { message: '图片重试完成' });
        controller.close();
      } catch (error) {
        const err = error as Error;
        console.error('[ORCHESTRATOR] 单图重试失败:', err);
        handleStreamError(controller, [], err, 'ImageRetry');
      }
    },
  });
}

async function getPreviousStylistCache(
  conversationId: string,
  excludeMessageId?: string
): Promise<StylistCacheNode | null> {
  const messages = await prismadb.message.findMany({
    where: { conversationId, role: 'assistant' },
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: { id: true, content: true },
  });

  for (const msg of messages) {
    if (excludeMessageId && msg.id === excludeMessageId) continue;
    const cache = extractStylistCache(msg.content);
    if (cache) return cache;
  }
  return null;
}

async function getProfileLocation(clientId?: string): Promise<string | undefined> {
  if (!clientId) return undefined;

  try {
    const profile = await prismadb.clientProfile.findUnique({
      where: { id: clientId },
      select: { profileData: true },
    });
    if (!profile?.profileData || typeof profile.profileData !== 'object') return undefined;

    const location = (profile.profileData as Record<string, unknown>).location;
    return typeof location === 'string' && location.trim() ? location.trim() : undefined;
  } catch (error) {
    console.warn('[ORCHESTRATOR] Failed to read profile location:', error);
    return undefined;
  }
}

export interface MultiAgentStreamOptions {
  clientIp?: string;
}

export function createMultiAgentStream(
  initialParts: Part[],
  clientId?: string,
  conversationId?: string,
  messageId?: string,
  options: MultiAgentStreamOptions = {}
): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      console.log('[ORCHESTRATOR] --- 启动全新 Multi-Agent 编排流 ---');

      let finalMessageId = messageId;
      let accumulatedContent = '';
      const imageMap = new Map<string, string>();
      const failedImageIds = new Set<string>();
      const ragCache = new Map<string, ClothingItem>();
      let stylistCacheNode: StylistCacheNode | null = null;
      let activeStylistResult: StylistResult | null = null;
      let wardrobeCandidatesNode: WardrobeCandidatesNode | null = null;
      let activeIntent: GatekeeperIntent | undefined;

      let mainError: Error | null = null;

      try {
        const { historyForAI, failedMessage } = await buildContext(conversationId, finalMessageId);

        let cachedStylistResult: StylistResult | null = null;
        let cachedProfile: UserProfileResult | null = null;

        if (failedMessage) {
          const cacheFromMessage = extractStylistCache(failedMessage.content);
          if (cacheFromMessage) {
            console.log('[ORCHESTRATOR] 发现搭配师方案缓存，启动【断点续传】优化！');
            stylistCacheNode = cacheFromMessage;
            cachedStylistResult = cacheFromMessage.stylist_result;
            cachedProfile = cacheFromMessage.user_profile;

            for (const item of cacheFromMessage.wardrobe_items ?? []) {
              ragCache.set(item.id, item);
            }
          }
        }

        if (cachedStylistResult && cachedProfile) {
          activeStylistResult = cachedStylistResult;
          await executeParallelAgents(
            cachedStylistResult,
            cachedProfile.personal_style,
            ragCache,
            controller,
            imageMap,
            failedImageIds,
            (text) => {
              accumulatedContent += text;
            },
            { conversationId, messageId: finalMessageId }
          );
        } else {
          if (!finalMessageId) {
            if (!conversationId) throw new Error('conversationId is required');
            const placeholder = await prismadb.message.create({
              data: {
                conversationId,
                role: 'assistant',
                content: [{ type: 'text', content: '' }] as Prisma.InputJsonValue,
                status: 'generating',
                timestamp: new Date(),
              },
              select: { id: true },
            });
            finalMessageId = placeholder.id;
            sendEvent(controller, 'metadata', { messageId: finalMessageId });
          }

          const gatekeeperCtx: GatekeeperContext = {
            clientIp: options.clientIp,
            profileLocation: await getProfileLocation(clientId),
            clientId,
          };

          const gatekeeperResult: GatekeeperResult = await callGatekeeperAgent(
            historyForAI,
            initialParts,
            gatekeeperCtx,
            { conversationId, messageId: finalMessageId }
          );

          if (gatekeeperResult.extracted_intent.request_type === 'style_advice') {
            activeIntent = gatekeeperResult.extracted_intent;
            const adviceProfile = clientId
              ? await loadUserProfileFromDb(clientId)
              : buildUserProfileFallback();
            const adviceResult = await callStylistAdvice(
              historyForAI,
              initialParts,
              activeIntent,
              adviceProfile
            );
            await callCopywriterAdviceStream(
              adviceResult,
              adviceProfile.personal_style,
              controller,
              (text) => {
                accumulatedContent += text;
              },
              { conversationId, messageId: finalMessageId }
            );
            return;
          }

          if (!gatekeeperResult.is_complete) {
            const questionsText =
              gatekeeperResult.gatekeeper_reply?.trim() ||
              gatekeeperResult.followup_questions.join(' ');
            sendEvent(controller, 'text_chunk', { text: questionsText });
            accumulatedContent = questionsText;

            if (gatekeeperResult.wardrobe_candidates?.length) {
              wardrobeCandidatesNode = {
                type: 'wardrobe_candidates',
                items: gatekeeperResult.wardrobe_candidates,
                prompt: questionsText,
              };
              sendEvent(controller, 'wardrobe_candidates', {
                items: gatekeeperResult.wardrobe_candidates,
              });
            }
            return;
          }

          activeIntent = gatekeeperResult.extracted_intent;
          const previousStylistCache =
            conversationId && activeIntent.request_type === 'feedback_revision'
              ? await getPreviousStylistCache(conversationId, finalMessageId)
              : null;

          if (previousStylistCache) {
            for (const item of previousStylistCache.wardrobe_items ?? []) {
              ragCache.set(item.id, item);
            }
          }

          const anchorWardrobeId = activeIntent?.anchor_wardrobe_id?.trim();
          if (anchorWardrobeId && clientId) {
            try {
              const anchorItem = await prismadb.clothingItem.findFirst({
                where: { id: anchorWardrobeId, clientProfileId: clientId },
              });
              if (anchorItem) ragCache.set(anchorItem.id, anchorItem);
            } catch (e) {
              console.warn('[ORCHESTRATOR] Failed to preload wardrobe anchor item:', e);
            }
          }

          let userProfileResult: UserProfileResult;
          const currentUserText = initialParts
            .filter((p): p is { text: string } => 'text' in p && Boolean(p.text?.trim()))
            .map((p) => p.text)
            .join('\n');

          if (shouldSkipProfileAgentUpdate(activeIntent, currentUserText) && clientId) {
            console.log('[ORCHESTRATOR] 跳过 Profile Agent — 本轮为操作/确认类消息');
            userProfileResult = await loadUserProfileFromDb(clientId);
          } else {
            try {
              userProfileResult = await callUserProfileAgent(historyForAI, initialParts, clientId, {
                conversationId,
                messageId: finalMessageId,
                userMessage: currentUserText,
              });
            } catch (e) {
              console.warn('[ORCHESTRATOR] User Profile 失败，启动保底画像:', e);
              userProfileResult = clientId
                ? await loadUserProfileFromDb(clientId)
                : buildUserProfileFallback();
            }
          }

          let stylistResult: StylistResult;
          try {
            stylistResult = await callStylistAgent(
              historyForAI,
              gatekeeperResult.extracted_intent,
              userProfileResult,
              initialParts,
              clientId,
              ragCache,
              conversationId,
              { previousStylistCache }
            );

            stylistCacheNode = {
              type: 'stylist_cache',
              stylist_result: stylistResult,
              user_profile: userProfileResult,
              wardrobe_items: Array.from(ragCache.values()),
            };
            activeStylistResult = stylistResult;

            if (finalMessageId) {
              await prismadb.message.update({
                where: { id: finalMessageId },
                data: {
                  content: buildPersistedMessageContent({
                    text: '',
                    stylistCache: stylistCacheNode,
                    imageStates: {},
                  }) as Prisma.InputJsonValue,
                },
              });
              console.log('[ORCHESTRATOR] 搭配师方案与衣橱缓存成功保存。');
            }
          } catch (e) {
            console.error('[ORCHESTRATOR] Stylist 灾难性失败:', e);
            throw new Error('StylistFailed: 搭配师开小差了，请稍后再试~');
          }

          // 对比前后方案单品，检测 feedback_revision 是否真的换了品
          let revisionNoItemChange = false;
          if (activeIntent.request_type === 'feedback_revision' && previousStylistCache && stylistResult.outfits.length > 0) {
            const revisionOutfitId = activeIntent.selected_outfit_id?.trim() || 'outfit_1';
            const prevOutfit =
              previousStylistCache.stylist_result.outfits.find((o) => o.id === revisionOutfitId) ??
              previousStylistCache.stylist_result.outfits[0];
            const newOutfit = stylistResult.outfits[0];
            if (prevOutfit && newOutfit) {
              const prevIds = new Set(prevOutfit.selected_items.map((i) => i.id));
              const newIds = new Set(newOutfit.selected_items.map((i) => i.id));
              revisionNoItemChange =
                prevIds.size === newIds.size && [...prevIds].every((id) => newIds.has(id));
              if (revisionNoItemChange) {
                console.log('[ORCHESTRATOR] feedback_revision: 单品未变，Copywriter 将如实说明原方案已适合');
              }
            }
          }

          await executeParallelAgents(
            stylistResult,
            userProfileResult.personal_style,
            ragCache,
            controller,
            imageMap,
            failedImageIds,
            (text) => {
              accumulatedContent += text;
            },
            { conversationId, messageId: finalMessageId },
            activeIntent,
            revisionNoItemChange
          );
        }
      } catch (error) {
        mainError = error as Error;
        console.error('[ORCHESTRATOR] 编排流运行中发生错误:', mainError);
      } finally {
        if (finalMessageId) {
          try {
            const finalContent = applyImageResultsToText(accumulatedContent, imageMap);

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
              imageMap,
              failedImageIds,
              outfitIds,
              status: mainError ? 'failed' : 'completed',
              wardrobeCandidates: wardrobeCandidatesNode,
            });
            console.log(
              `[ORCHESTRATOR] 数据库记录 ${finalMessageId} 已更新，状态: ${mainError ? 'failed' : 'completed'}`
            );
          } catch (dbError) {
            console.error('[ORCHESTRATOR] 更新数据库最终状态失败:', dbError);
          }
        }

        if (mainError) {
          handleStreamError(controller, [], mainError, 'OrchestratorProcess');
        } else {
          sendEvent(controller, 'stream_end', { message: '所有内容已加载完毕' });
          try {
            controller.close();
          } catch (e) {
            console.warn('[ORCHESTRATOR] 流控制器关闭失败 (可能已被客户端取消):', e);
          }
        }
      }
    },
    cancel(reason) {
      console.warn('[ORCHESTRATOR] 流被客户端取消，原因:', reason);
    },
  });
}
