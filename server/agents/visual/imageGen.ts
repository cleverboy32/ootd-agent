import retry from 'async-retry';
import { genAI } from '@/server/services/ai';
import { urlToGenerativePart } from '@/server/utils/image';
import { Part } from '@google/genai';
import { AGENT_MODELS, IMAGE_GEN_RETRY } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { logImageGenAudit } from '@/server/logging/imageGen';
import type { StylistOutfit } from '@/server/agents/stylist';
import type { AnchorItemImageData } from '@/server/agents/intent';

export type ImageGenTrigger = 'initial' | 'user_retry';

/** 直接用搭配师方案拼装图像提示词，避免二次扩写引入偏差 */
export function buildImagePrompt(outfit: StylistOutfit): string {
  const items = outfit.selected_items
    .map((i) => `${i.name} (${i.layer})`)
    .join(', ');

  return [
    'Fashion editorial photography, photorealistic, highly detailed fabric textures.',
    `Pose: ${outfit.visual_composition.model_pose}`,
    `Outfit: ${outfit.visual_composition.outfit_details}`,
    `Wardrobe items: ${items}`,
    `Scene: ${outfit.visual_composition.background}`,
  ].join('\n');
}

export async function attemptGenerateOutfitImage(
  outfit: StylistOutfit,
  wardrobeImageUrls: string[],
  anchorImageData: AnchorItemImageData | undefined,
  imgPrompt: string
): Promise<{ data: string; mimeType: string; mode: 'multimodal' | 'text-only' }> {
  let imageResponse;
  let useFallback = false;
  let mode: 'multimodal' | 'text-only' = 'text-only';

  try {
    if (wardrobeImageUrls.length > 0 || anchorImageData) {
      mode = 'multimodal';
      const multiModalParts: Part[] = [];
      if (anchorImageData) {
        multiModalParts.push({
          inlineData: { data: anchorImageData.data, mimeType: anchorImageData.mimeType },
        });
      }
      for (const url of wardrobeImageUrls) {
        try {
          multiModalParts.push(await urlToGenerativePart(url));
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.warn(`[VISUAL_DIRECTOR] Failed to convert wardrobe image URL, skipping: ${url} (${message})`);
        }
      }
      multiModalParts.push({ text: imgPrompt });

      imageResponse = await withRetryOn429(
        () =>
          genAI.models.generateContent({
            model: AGENT_MODELS.imageGen,
            contents: [{ role: 'user', parts: multiModalParts }],
          }),
        { label: `ImageGen multimodal (${outfit.id})` }
      );
    } else {
      imageResponse = await withRetryOn429(
        () =>
          genAI.models.generateContent({
            model: AGENT_MODELS.imageGen,
            contents: [{ role: 'user', parts: [{ text: imgPrompt }] }],
          }),
        { label: `ImageGen text-only (${outfit.id})` }
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[VISUAL_DIRECTOR] Multimodal generation failed, falling back to text-only: ${message}`);
    useFallback = true;
  }

  let imagePart = !useFallback
    ? imageResponse?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
    : null;

  if (!imagePart?.inlineData) {
    mode = 'text-only';
    imageResponse = await withRetryOn429(
      () =>
        genAI.models.generateContent({
          model: AGENT_MODELS.imageGen,
          contents: [{ role: 'user', parts: [{ text: imgPrompt }] }],
        }),
      { label: `ImageGen fallback (${outfit.id})` }
    );
    imagePart = imageResponse?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  }

  if (!imagePart?.inlineData?.data || !imagePart?.inlineData?.mimeType) {
    throw new Error('Image generation API did not return image data.');
  }

  return {
    data: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType,
    mode,
  };
}

export async function generateOutfitImage(
  outfit: StylistOutfit,
  wardrobeImageUrls: string[],
  anchorImageData: AnchorItemImageData | undefined,
  imgPrompt: string,
  trigger: ImageGenTrigger,
  messageId?: string
): Promise<{ data: string; mimeType: string }> {
  return retry(
    async (bail, attemptNumber) => {
      try {
        const result = await attemptGenerateOutfitImage(outfit, wardrobeImageUrls, anchorImageData, imgPrompt);
        void logImageGenAudit({
          timestamp: new Date().toISOString(),
          outfitId: outfit.id,
          messageId,
          attempt: attemptNumber,
          mode: result.mode,
          success: true,
          trigger,
        });
        return { data: result.data, mimeType: result.mimeType };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void logImageGenAudit({
          timestamp: new Date().toISOString(),
          outfitId: outfit.id,
          messageId,
          attempt: attemptNumber,
          mode: wardrobeImageUrls.length > 0 || anchorImageData ? 'multimodal' : 'text-only',
          success: false,
          error: message,
          trigger,
        });

        if (message.includes('did not return image data')) {
          bail(error as Error);
          return { data: '', mimeType: '' };
        }
        throw error;
      }
    },
    {
      retries: IMAGE_GEN_RETRY.retries,
      factor: IMAGE_GEN_RETRY.factor,
      minTimeout: IMAGE_GEN_RETRY.minTimeoutMs,
      onRetry: (error, attempt) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[VISUAL_DIRECTOR] Image gen attempt ${attempt} failed for ${outfit.id}: ${message}`);
      },
    }
  );
}
