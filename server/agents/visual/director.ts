import { uploadImageToCOS } from '@/server/services/cos';
import { sendEvent } from '@/server/utils/stream-helpers';
import type { StylistOutfit } from '@/server/agents/stylist';
import type { AnchorItemImageData } from '@/server/agents/intent';
import type { ClothingItem } from '@prisma/client';
import type { UserProfileResult } from '@/server/agents/user-profile/schema';
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
  options?: {
    trigger?: ImageGenTrigger;
    messageId?: string;
    ragCache?: Map<string, ClothingItem>;
    userProfile?: UserProfileResult | null;
  }
): Promise<void> {
  const trigger = options?.trigger ?? 'initial';
  console.log(`[VISUAL_DIRECTOR] Starting image generation for outfit ${outfit.id} (${trigger})...`);

  const imgPrompt = buildImagePrompt(outfit, options?.ragCache);

  const { data: imageBase64, mimeType } = await generateOutfitImage(
    outfit,
    wardrobeImageUrls,
    anchorImageData,
    imgPrompt,
    trigger,
    options?.messageId,
    options?.ragCache,
    options?.userProfile
  );

  const destinationFileName = `outfits/${Date.now()}-${imageId}.png`;
  const publicUrl = await uploadImageToCOS(imageBase64, mimeType, destinationFileName);
  console.log(`[VISUAL_DIRECTOR] Uploaded successfully. URL: ${publicUrl}`);

  sendEvent(controller, 'image_generated', {
    id: imageId,
    imageUrl: publicUrl,
    alt: outfit.overall_concept,
  });

  onImageGenerated?.(imageId, publicUrl);
  scheduleVisualAudit(outfit, imageId, publicUrl, imageBase64, mimeType);
}
