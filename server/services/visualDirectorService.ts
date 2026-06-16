import retry from 'async-retry';
import { genAI } from './ai';
import { uploadImageToGCS } from './gcs';
import { sendEvent } from '../utils/stream-helpers';
import { urlToGenerativePart } from '../utils/image';
import { Part, Type, Schema } from '@google/genai';
import { AGENT_MODELS, IMAGE_GEN_RETRY } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { logVisualAudit } from './visualAuditLogger';
import { logImageGenAudit } from './imageGenAuditLogger';
import { StylistOutfit } from '../../app/api/generate-with-image/handlers/stylistAgent';
import { AnchorItemImageData } from '../../app/api/generate-with-image/handlers/intentTypes';

export type ImageGenTrigger = 'initial' | 'user_retry';

const criticSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    approved: {
      type: Type.BOOLEAN,
      description: '图片是否通过审核。若完全符合搭配师方案，为 true；否则为 false。'
    },
    critique_reason: {
      type: Type.STRING,
      description: '若未通过，用中文指出具体画错了什么（如：短裤颜色画成了白色，而不是暗灰色）。若通过，填空字符串。'
    },
    revised_prompt_enhancement: {
      type: Type.STRING,
      description: '若未通过，给出用于修正和强化的英文提示词（例如：CRITICAL: The model MUST wear dark grey sports shorts. Do NOT use white shorts.）。若通过，填空字符串。'
    }
  },
  required: ['approved', 'critique_reason', 'revised_prompt_enhancement']
};

interface CriticResult {
  approved: boolean;
  critique_reason: string;
  revised_prompt_enhancement: string;
}

/** 直接用搭配师方案拼装图像提示词，避免二次扩写引入偏差 */
function buildImagePrompt(outfit: StylistOutfit): string {
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

const CRITIC_SYSTEM_INSTRUCTION = `
你是一个极其挑剔的时尚监片人与视觉审核专家。
请仔细对比【搭配师指定方案的结构化内容】和【当前生成的图片】。

【审核硬性指标】
1. 单品完整度：搭配师指定的关键衣橱单品（如粉色上衣、灰色短裤）是否都在图里？
2. 色彩一致性：衣服的颜色是否画错或画反？（例如：搭配师要粉色上衣+灰色短裤，图里是否画成了粉色短裤？）
3. 场景契合度：背景（如乒乓球馆、雨天街头）是否符合设定？

【输出规则】
- 如果完全符合，approved 设为 true。
- 如果不符合，approved 设为 false，并在 critique_reason 中指出具体问题，在 revised_prompt_enhancement 中给出修正和强化的英文提示词。
`;

async function auditImage(
  outfit: StylistOutfit,
  imageBase64: string,
  mimeType: string
): Promise<CriticResult> {
  console.log(`[VISUAL_DIRECTOR] Auditing generated image for outfit ${outfit.id}...`);

  const prompt = `
【搭配师指定方案】
- 核心概念: ${outfit.overall_concept}
- 选用单品: ${outfit.selected_items.map(i => `${pName(i)} (${i.layer})`).join(', ')}
- 视觉构想: ${outfit.visual_composition.outfit_details} paired with ${outfit.visual_composition.background}

请仔细审核上传的图片，判断是否 100% 契合上述方案。
`;

  const response = await withRetryOn429(
    () =>
      genAI.models.generateContent({
        model: AGENT_MODELS.visualCritic,
        contents: [
          {
            inlineData: {
              data: imageBase64,
              mimeType,
            },
          },
          { text: prompt },
        ],
        config: {
          systemInstruction: CRITIC_SYSTEM_INSTRUCTION,
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: criticSchema,
        },
      }),
    { label: `VisualDirector critic (${outfit.id})` }
  );

  const responseText = response.text;
  if (!responseText) {
    throw new Error('Empty response from Critic Agent');
  }

  return JSON.parse(responseText) as CriticResult;
}

function pName(item: { name: string }) {
  return item.name;
}

function scheduleVisualAudit(
  outfit: StylistOutfit,
  imageId: string,
  imageUrl: string,
  imageBase64: string,
  mimeType: string
): void {
  void (async () => {
    const baseEntry = {
      timestamp: new Date().toISOString(),
      outfitId: outfit.id,
      imageId,
      imageUrl,
      overallConcept: outfit.overall_concept,
    };

    try {
      const auditResult = await auditImage(outfit, imageBase64, mimeType);
      console.log(`[VISUAL_DIRECTOR] Audit completed for outfit ${outfit.id}:`, auditResult);

      await logVisualAudit({
        ...baseEntry,
        approved: auditResult.approved,
        critiqueReason: auditResult.critique_reason,
        revisedPromptEnhancement: auditResult.revised_prompt_enhancement,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[VISUAL_DIRECTOR] Audit failed for outfit ${outfit.id}: ${message}`);

      await logVisualAudit({
        ...baseEntry,
        approved: null,
        critiqueReason: '',
        revisedPromptEnhancement: '',
        auditError: message,
      });
    }
  })().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[VISUAL_DIRECTOR] Unhandled audit error for outfit ${outfit.id}: ${message}`);
  });
}

async function attemptGenerateOutfitImage(
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
          inlineData: {
            data: anchorImageData.data,
            mimeType: anchorImageData.mimeType,
          },
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

async function generateOutfitImage(
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
        const result = await attemptGenerateOutfitImage(
          outfit,
          wardrobeImageUrls,
          anchorImageData,
          imgPrompt
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
        console.warn(
          `[VISUAL_DIRECTOR] Image gen attempt ${attempt} failed for ${outfit.id}: ${message}`
        );
      },
    }
  );
}

/**
 * 生成图片并立即展示；审核在后台异步执行，结果写入 logs/visual-audit.jsonl。
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
