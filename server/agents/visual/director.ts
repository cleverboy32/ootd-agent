import { uploadImageToGCS } from '@/server/services/gcs';
import { sendEvent } from '@/server/utils/stream-helpers';
import type { StylistOutfit } from '@/server/agents/stylist';
import type { AnchorItemImageData } from '@/server/agents/intent';
import { buildImagePrompt, generateOutfitImage, ImageGenTrigger } from './imageGen';
import { scheduleVisualAudit } from './critic';

export type { ImageGenTrigger } from './imageGen';

/**
 * 生成图片并立即展示；审核在后台异步执行，结果写入 log/visual-audit.jsonl。
 */
export async function callVisualDirectorAgent(
  controller: ReadableStreamDefaultController,
  outfit: StylistOutfit,
  wardrobeImageUrls: string[],
  anchorImageData: AnchorItemImageData | undefined,
  imageId: string,
  onImageGenerated?: (id: string, url: string) => void,
  options?: { trigger?: ImageGenTrigger; messageId?: string }
): Promise<void> {
  const trigger = options?.trigger ?? 'initial';
  console.log(`[VISUAL_DIRECTOR] Starting image generation for outfit ${outfit.id} (${trigger})...`);

  const imgPrompt = buildImagePrompt(outfit);

  const { data: imageBase64, mimeType } = await generateOutfitImage(
    outfit,
    wardrobeImageUrls,
    anchorImageData,
    imgPrompt,
    trigger,
    options?.messageId
  );

  const destinationFileName = `outfits/${Date.now()}-${imageId}.png`;
  const publicUrl = await uploadImageToGCS(imageBase64, mimeType, destinationFileName);
  console.log(`[VISUAL_DIRECTOR] Uploaded successfully. URL: ${publicUrl}`);

  sendEvent(controller, 'image_generated', {
    id: imageId,
    imageUrl: publicUrl,
    alt: outfit.overall_concept,
  });

  onImageGenerated?.(imageId, publicUrl);
  scheduleVisualAudit(outfit, imageId, publicUrl, imageBase64, mimeType);
}
