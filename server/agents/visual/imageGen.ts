import retry from 'async-retry';
import { genAI } from '@/server/services/ai';
import { urlToGenerativePart } from '@/server/utils/image';
import { Modality, Part, ThinkingLevel } from '@google/genai';
import { AGENT_MODELS, IMAGE_GEN_RETRY } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { logImageGenAudit } from '@/server/logging/imageGen';
import type { StylistOutfit } from '@/server/agents/stylist';
import type { AnchorItemImageData } from '@/server/agents/intent';
import type { ClothingItem } from '@prisma/client';

export type ImageGenTrigger = 'initial' | 'user_retry';

const IMAGE_GEN_SYSTEM_INSTRUCTION = [
  'Generate a fashion editorial photo.',
  'Strictly reproduce each wardrobe item silhouette, hem length, neckline, and fit from reference images and text.',
  'Do NOT change shorts to pants, alter skirt/dress lengths, or modify garment proportions.',
].join(' ');

const IMAGE_GEN_CONFIG = {
  responseModalities: [Modality.IMAGE],
  imageConfig: {
    aspectRatio: '3:4',
    imageSize: '1K',
  },
  thinkingConfig: {
    thinkingLevel: ThinkingLevel.HIGH,
  },
  systemInstruction: IMAGE_GEN_SYSTEM_INSTRUCTION,
};

/** 直接用搭配师方案拼装图像提示词，避免二次扩写引入偏差 */
export function buildImagePrompt(
  outfit: StylistOutfit,
  ragCache?: Map<string, ClothingItem>
): string {
  const itemLines = outfit.selected_items.map((i) => {
    const cached = ragCache?.get(i.id);
    const parts: string[] = [`${i.name} (${i.layer})`];
    if (cached?.description) parts.push(cached.description);
    if (cached?.tags?.length) parts.push(cached.tags.join(', '));
    return `  - ${parts.join(' | ')}`;
  });

  return [
    'Fashion editorial photography, photorealistic, highly detailed fabric textures.',
    'CRITICAL GARMENT FIDELITY: Every item must match its exact silhouette, hemline length, and fit as described. Do NOT alter proportions or lengths.',
    `Pose: ${outfit.visual_composition.model_pose}`,
    `Outfit: ${outfit.visual_composition.outfit_details}`,
    'Wardrobe items:',
    ...itemLines,
    `Scene: ${outfit.visual_composition.background}`,
  ].join('\n');
}

function callImageGen(parts: Part[]) {
  return genAI.models.generateContent({
    model: AGENT_MODELS.imageGen,
    contents: [{ role: 'user', parts }],
    config: IMAGE_GEN_CONFIG,
  });
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
        () => callImageGen(multiModalParts),
        { label: `ImageGen multimodal (${outfit.id})` }
      );
    } else {
      imageResponse = await withRetryOn429(
        () => callImageGen([{ text: imgPrompt }]),
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
      () => callImageGen([{ text: imgPrompt }]),
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
