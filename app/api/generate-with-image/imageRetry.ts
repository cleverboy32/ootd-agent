import { ClothingItem, Prisma } from '@prisma/client';
import prismadb from '@/server/db';
import { sendEvent, handleStreamError } from '@/server/utils/stream-helpers';
import { callVisualDirectorAgent } from '@/server/agents/visual/director';
import { AnchorItemImageData } from '@/server/agents/intent';
import { StylistOutfit } from '@/server/agents/stylist';
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

/** 从 ragCache 中提取所有有效的图片 URL */
export function extractWardrobeUrls(ragCache: Map<string, ClothingItem>): string[] {
  return Array.from(ragCache.values())
    .map((item) => item.imageUrl)
    .filter((url): url is string => !!url);
}

export { applyImageResultsToText, buildImageStates };
