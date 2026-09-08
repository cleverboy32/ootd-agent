import retry from 'async-retry';
import { llmGenerateImage } from '@/server/services/llm/client';
import { getProvider } from '@/server/services/llm/provider';
import { isSeedreamImageVendor, SEEDREAM_MAX_REFERENCE_IMAGES } from '@/server/services/llm/seedream';
import { urlToGenerativePart } from '@/server/utils/image';
import { Part } from '@google/genai';
import { AGENT_MODELS, IMAGE_GEN_RETRY } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { logImageGenAudit } from '@/server/logging/imageGen';
import type { StylistOutfit } from '@/server/agents/stylist';
import type { AnchorItemImageData } from '@/server/agents/intent';
import type { UserProfileResult } from '@/server/agents/user-profile/schema';
import type { ClothingItem } from '@prisma/client';
import {
  buildSeedreamImagePrompt,
  SEEDREAM_SYSTEM_INSTRUCTION,
} from './seedreamPrompt';

export type ImageGenTrigger = 'initial' | 'user_retry';

const IMAGE_GEN_SYSTEM_INSTRUCTION = [
  'Generate a fashion editorial photo.',
  'Strictly reproduce each wardrobe item silhouette, hem length, neckline, and fit from reference images and text.',
  'Do NOT change shorts to pants, alter skirt/dress lengths, or modify garment proportions.',
  'Accessories (necklace, earrings, choker, bag, belt, etc.) must be worn at real-life scale — never enlarge jewelry or small accessories to match product close-up reference framing.',
].join(' ');

/** 配饰商品图多为特写，需显式约束真人佩戴比例 */
export const ACCESSORY_SCALE_HINT =
  'product close-up ref — wear at realistic on-body scale, do NOT enlarge to fill frame';

export function isAccessoryReferenceItem(
  layer?: string,
  mainCategory?: string | null
): boolean {
  if (layer === 'accessory') return true;
  return (mainCategory ?? '').toUpperCase() === 'ACCESSORY';
}

export function outfitHasAccessory(outfit: StylistOutfit, ragCache?: Map<string, ClothingItem>): boolean {
  return outfit.selected_items.some((item) => {
    const cached = ragCache?.get(item.id);
    return isAccessoryReferenceItem(item.layer, cached?.mainCategory);
  });
}

export function buildOutfitReferenceInputs(
  outfit: StylistOutfit,
  wardrobeImageUrls: string[],
  anchorImageData: AnchorItemImageData | undefined,
  ragCache?: Map<string, ClothingItem>,
  anchorImageUrl?: string,
  additionalPurchaseRefs?: Array<{ url: string; label: string }>
): { referenceUrls: string[]; referenceLabels: string[] } {
  const referenceUrls: string[] = [];
  const referenceLabels: string[] = [];
  const wardrobeItems = outfit.selected_items.filter((i) => i.id !== 'new_item');

  const resolvedAnchorUrl =
    anchorImageUrl?.trim() ||
    (anchorImageData?.data
      ? `data:${anchorImageData.mimeType};base64,${anchorImageData.data}`
      : undefined);

  if (resolvedAnchorUrl) {
    referenceUrls.push(resolvedAnchorUrl);
    const anchorItem =
      outfit.selected_items.find((i) => i.id === 'new_item') ?? wardrobeItems[0];
    referenceLabels.push(
      anchorItem
        ? `${anchorItem.name} (${anchorItem.layer}) — anchor garment`
        : 'anchor garment'
    );
  }

  for (const extra of additionalPurchaseRefs ?? []) {
    if (referenceUrls.length >= SEEDREAM_MAX_REFERENCE_IMAGES) break;
    const url = extra.url?.trim();
    if (!url || referenceUrls.includes(url)) continue;
    referenceUrls.push(url);
    referenceLabels.push(extra.label || 'additional purchase garment');
  }

  wardrobeImageUrls.forEach((url, idx) => {
    if (referenceUrls.length >= SEEDREAM_MAX_REFERENCE_IMAGES) return;
    referenceUrls.push(url);
    const item = wardrobeItems[idx];
    const cached = item ? ragCache?.get(item.id) : undefined;
    const parts = [
      item?.name,
      item?.layer,
      cached?.mainCategory,
      cached?.subCategory,
      cached?.colors?.length ? `colors: ${cached.colors.join(', ')}` : undefined,
      cached?.silhouette?.length ? `silhouette: ${cached.silhouette.join(', ')}` : undefined,
      cached?.description,
    ].filter(Boolean);
    if (isAccessoryReferenceItem(item?.layer, cached?.mainCategory)) {
      parts.push(ACCESSORY_SCALE_HINT);
    }
    referenceLabels.push(parts.join(' | ') || `wardrobe item ${idx + 1}`);
  });

  return { referenceUrls, referenceLabels };
}

/** 直接用搭配师方案拼装图像提示词，避免二次扩写引入偏差 */
export function buildImagePrompt(
  outfit: StylistOutfit,
  ragCache?: Map<string, ClothingItem>,
  referenceLabels?: string[]
): string {
  const itemLines = outfit.selected_items.map((i) => {
    const cached = ragCache?.get(i.id);
    const parts: string[] = [`${i.name} (${i.layer})`];
    if (cached?.description) parts.push(cached.description);
    if (cached?.tags?.length) parts.push(cached.tags.join(', '));
    return `  - ${parts.join(' | ')}`;
  });

  const lines = [
    'Fashion editorial photography, photorealistic, highly detailed fabric textures.',
    'CRITICAL GARMENT FIDELITY: Every item must match its exact silhouette, hemline length, and fit as described. Do NOT alter proportions or lengths.',
  ];

  if (outfitHasAccessory(outfit, ragCache)) {
    lines.push(
      'CRITICAL ACCESSORY SCALE: Jewelry and small accessories must appear at natural worn size relative to the body (earrings on earlobes, necklace at collarbone, choker snug on neck). Accessory reference photos are product close-ups — copy style/color only, NEVER scale the accessory up to match the reference image size.'
    );
  }

  if (referenceLabels?.length) {
    lines.push(
      'Reference wardrobe images (reproduce each exactly):',
      ...referenceLabels.map((label, i) => `  - 图${i + 1}: ${label}`),
      `The model must wear ALL garments from 图1 through 图${referenceLabels.length} with exact colors, silhouettes, and hem lengths.`
    );
  }

  lines.push(
    `Pose: ${outfit.visual_composition.model_pose}`,
    `Outfit: ${outfit.visual_composition.outfit_details}`,
    'Wardrobe items:',
    ...itemLines,
    `Scene: ${outfit.visual_composition.background}`
  );

  return lines.join('\n');
}

async function callImageGen(prompt: string, parts?: Part[], referenceImageUrls?: string[]) {
  if (
    getProvider('image') !== 'vertex' &&
    !isSeedreamImageVendor() &&
    parts?.some((p) => p.inlineData)
  ) {
    console.warn(
      '[VISUAL_DIRECTOR] OpenAI-compatible image APIs ignore wardrobe reference images; using text prompt only.'
    );
  }

  const generated = await llmGenerateImage(prompt, AGENT_MODELS.imageGen, parts, referenceImageUrls);
  return {
    candidates: [
      {
        content: {
          parts: [{ inlineData: { data: generated.data, mimeType: generated.mimeType } }],
        },
      },
    ],
  };
}

async function generateWithSeedream(
  outfit: StylistOutfit,
  wardrobeImageUrls: string[],
  anchorImageData: AnchorItemImageData | undefined,
  imgPrompt: string,
  ragCache?: Map<string, ClothingItem>,
  userProfile?: UserProfileResult | null,
  anchorImageUrl?: string,
  additionalPurchaseRefs?: Array<{ url: string; label: string }>
): Promise<{ data: string; mimeType: string; mode: 'multimodal' | 'text-only' }> {
  const { referenceUrls, referenceLabels } = buildOutfitReferenceInputs(
    outfit,
    wardrobeImageUrls,
    anchorImageData,
    ragCache,
    anchorImageUrl,
    additionalPurchaseRefs
  );
  const prompt = buildSeedreamImagePrompt(outfit, ragCache, referenceLabels, userProfile);
  const fullPrompt = `${SEEDREAM_SYSTEM_INSTRUCTION}\n${prompt}`;

  const imageResponse = await withRetryOn429(
    () => callImageGen(fullPrompt, undefined, referenceUrls),
    { label: `ImageGen Seedream (${outfit.id})` }
  );

  const imagePart = imageResponse.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!imagePart?.inlineData?.data || !imagePart.inlineData.mimeType) {
    throw new Error('Image generation API did not return image data.');
  }

  return {
    data: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType,
    mode: referenceUrls.length > 0 ? 'multimodal' : 'text-only',
  };
}

export async function attemptGenerateOutfitImage(
  outfit: StylistOutfit,
  wardrobeImageUrls: string[],
  anchorImageData: AnchorItemImageData | undefined,
  imgPrompt: string,
  ragCache?: Map<string, ClothingItem>,
  userProfile?: UserProfileResult | null,
  anchorImageUrl?: string,
  additionalPurchaseRefs?: Array<{ url: string; label: string }>
): Promise<{ data: string; mimeType: string; mode: 'multimodal' | 'text-only' }> {
  if (isSeedreamImageVendor()) {
    return generateWithSeedream(
      outfit,
      wardrobeImageUrls,
      anchorImageData,
      imgPrompt,
      ragCache,
      userProfile,
      anchorImageUrl,
      additionalPurchaseRefs
    );
  }

  let imageResponse;
  let useFallback = false;
  let mode: 'multimodal' | 'text-only' = 'text-only';
  const extraUrls = (additionalPurchaseRefs ?? []).map((r) => r.url.trim()).filter(Boolean);
  const hasAnchor = Boolean(anchorImageData?.data || anchorImageUrl?.trim() || extraUrls.length);

  try {
    if (wardrobeImageUrls.length > 0 || hasAnchor) {
      mode = 'multimodal';
      const multiModalParts: Part[] = [];
      if (anchorImageData?.data) {
        multiModalParts.push({
          inlineData: { data: anchorImageData.data, mimeType: anchorImageData.mimeType },
        });
      } else if (anchorImageUrl?.trim()) {
        try {
          multiModalParts.push(await urlToGenerativePart(anchorImageUrl.trim()));
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.warn(
            `[VISUAL_DIRECTOR] Failed to convert anchor image URL, skipping: ${anchorImageUrl} (${message})`
          );
        }
      }
      for (const url of extraUrls) {
        try {
          multiModalParts.push(await urlToGenerativePart(url));
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.warn(`[VISUAL_DIRECTOR] Failed to convert extra purchase URL, skipping: ${url} (${message})`);
        }
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
        () => callImageGen(`${IMAGE_GEN_SYSTEM_INSTRUCTION}\n${imgPrompt}`, multiModalParts),
        { label: `ImageGen multimodal (${outfit.id})` }
      );
    } else {
      imageResponse = await withRetryOn429(
        () => callImageGen(`${IMAGE_GEN_SYSTEM_INSTRUCTION}\n${imgPrompt}`),
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
      () => callImageGen(`${IMAGE_GEN_SYSTEM_INSTRUCTION}\n${imgPrompt}`),
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
  messageId?: string,
  ragCache?: Map<string, ClothingItem>,
  userProfile?: UserProfileResult | null,
  anchorImageUrl?: string,
  additionalPurchaseRefs?: Array<{ url: string; label: string }>
): Promise<{ data: string; mimeType: string }> {
  return retry(
    async (bail, attemptNumber) => {
      try {
        const result = await attemptGenerateOutfitImage(
          outfit,
          wardrobeImageUrls,
          anchorImageData,
          imgPrompt,
          ragCache,
          userProfile,
          anchorImageUrl,
          additionalPurchaseRefs
        );
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
          mode:
            wardrobeImageUrls.length > 0 || anchorImageData || anchorImageUrl
              ? 'multimodal'
              : 'text-only',
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
