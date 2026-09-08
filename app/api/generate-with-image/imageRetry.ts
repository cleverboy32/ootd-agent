import { ClothingItem, Prisma } from '@prisma/client';
import prismadb from '@/server/db';
import { sendEvent, handleStreamError } from '@/server/utils/stream-helpers';
import { callVisualDirectorAgent } from '@/server/agents/visual/director';
import { AnchorItemImageData } from '@/server/agents/intent';
import { StylistOutfit } from '@/server/agents/stylist';
import type { UserProfileResult } from '@/server/agents/user-profile/schema';
import {
  logRequestAudit,
  RequestAuditKind,
  RequestAuditOutcome,
  RequestAuditRoute,
  RequestTrace,
} from '@/server/logging/request';
import {
  applyImageResultsToText,
  buildImageStates,
  buildPersistedMessageContent,
  extractStylistCache,
  extractImageStates,
  extractTextContent,
  patchMessageImageResult,
} from '@/server/utils/messageContent';

export async function runOutfitImageGeneration(
  outfit: StylistOutfit,
  wardrobeUrls: string[],
  anchorImageData: AnchorItemImageData | undefined,
  controller: ReadableStreamDefaultController,
  imageMap: Map<string, string>,
  failedImageIds: Set<string>,
  messageId?: string,
  trigger: 'initial' | 'user_retry' = 'initial',
  ragCache?: Map<string, ClothingItem>,
  userProfile?: UserProfileResult | null,
  anchorImageUrl?: string,
  additionalPurchaseRefs?: Array<{ url: string; label: string }>
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
      { trigger, messageId, ragCache, userProfile, anchorImageUrl, additionalPurchaseRefs }
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

/** 单张效果图用户重试：仅重跑 VisualDirector，复用 stylist_cache */
export function createImageRetryStream(
  conversationId: string,
  messageId: string,
  retryOutfitId: string
): ReadableStream {
  const trace = new RequestTrace({
    kind: RequestAuditKind.ImageRetry,
    conversationId,
    messageId,
    route: RequestAuditRoute.ImageRetry,
  });

  return new ReadableStream({
    async start(controller) {
      console.log(`[ORCHESTRATOR] --- 单图重试: message=${messageId} outfit=${retryOutfitId} ---`);

      let mainError: Error | null = null;
      const imageMap = new Map<string, string>();
      const failedImageIds = new Set<string>();
      let ragItemCount = 0;

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
        ragItemCount = ragCache.size;

        const imageStartedAt = Date.now();
        await runOutfitImageGeneration(
          outfit,
          extractSelectedItemUrls(outfit, ragCache),
          stylistCache.stylist_result.anchor_item_image_data,
          controller,
          imageMap,
          failedImageIds,
          messageId,
          'user_retry',
          ragCache,
          null,
          stylistCache.stylist_result.anchor_image_url
        );
        trace.markStage('imageGen', Date.now() - imageStartedAt);

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
        try {
          controller.close();
        } catch (e) {
          console.warn('[ORCHESTRATOR] 单图重试流关闭失败 (可能已被客户端取消):', e);
        }
      } catch (error) {
        mainError = error as Error;
        console.error('[ORCHESTRATOR] 单图重试失败:', mainError);
        handleStreamError(controller, [], mainError, 'ImageRetry');
      } finally {
        void logRequestAudit(
          trace.finalize({
            outcome: mainError ? RequestAuditOutcome.Failed : RequestAuditOutcome.Completed,
            errorMessage: mainError?.message,
            messageId,
            summary: {
              outfitCount: 1,
              imageSuccessCount: imageMap.size,
              imageFailedCount: failedImageIds.size,
              ragItemCount,
            },
          })
        );
      }
    },
    cancel(reason) {
      console.warn('[ORCHESTRATOR] 单图重试流被客户端取消，原因:', reason);
      trace.markCancelled(reason);
    },
  });
}

/** 只提取某套方案实际选中的衣橱单品图片（排除 new_item），减少图生图的噪声输入 */
export function extractSelectedItemUrls(outfit: StylistOutfit, ragCache: Map<string, ClothingItem>): string[] {
  return outfit.selected_items
    .filter((i) => i.id !== 'new_item')
    .map((i) => ragCache.get(i.id)?.imageUrl)
    .filter((url): url is string => !!url);
}

export { applyImageResultsToText, buildImageStates };
