import { Part } from '@google/genai';
import { ClothingItem, Prisma } from '@prisma/client';
import prismadb from '@/server/db';
import { sendEvent, handleStreamError } from '@/server/utils/stream-helpers';

import { callGatekeeperAgent, buildGatekeeperFallback } from './handlers/gatekeeperAgent';
import { callUserProfileAgent, buildUserProfileFallback, UserProfileResult } from './handlers/userProfileAgent';
import { callStylistAgent, StylistOutfit, StylistResult } from './handlers/stylistAgent';
import { callCopywriterAgentStream, CopywriterAuditMeta } from './handlers/copywriterAgent';
import { callVisualDirectorAgent } from '@/server/services/visualDirectorService';
import { AnchorItemImageData } from './handlers/intentTypes';
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
  auditMeta?: CopywriterAuditMeta
): Promise<void> {
  console.log('[ORCHESTRATOR] 启动并行双轨执行链 (文案流 + 视觉导演并行画图)...');

  const copywriterPromise = callCopywriterAgentStream(
    stylistResult,
    personalStyle,
    controller,
    onText,
    auditMeta
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
  }
): Promise<void> {
  const imageStates = buildImageStates(options.outfitIds, options.imageMap, options.failedImageIds);
  const content = buildPersistedMessageContent({
    text: options.text,
    stylistCache: options.stylistCache,
    imageStates,
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

export function createMultiAgentStream(
  initialParts: Part[],
  clientId?: string,
  conversationId?: string,
  messageId?: string
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

          let gatekeeperResult;
          try {
            gatekeeperResult = await callGatekeeperAgent(historyForAI, initialParts);
          } catch (e) {
            console.warn('[ORCHESTRATOR] Gatekeeper 失败，启动保底放行:', e);
            gatekeeperResult = buildGatekeeperFallback(initialParts, historyForAI);
          }

          if (!gatekeeperResult.is_complete) {
            const questionsText = gatekeeperResult.followup_questions.join(' ');
            sendEvent(controller, 'text_chunk', { text: questionsText });
            accumulatedContent = questionsText;
            return;
          }

          let userProfileResult: UserProfileResult;
          try {
            userProfileResult = await callUserProfileAgent(historyForAI, initialParts, clientId);
          } catch (e) {
            console.warn('[ORCHESTRATOR] User Profile 失败，启动保底画像:', e);
            userProfileResult = buildUserProfileFallback();
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
              conversationId
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
            { conversationId, messageId: finalMessageId }
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
