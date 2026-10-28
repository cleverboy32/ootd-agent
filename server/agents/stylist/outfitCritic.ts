import { Type, type Schema } from '@google/genai';
import { llmGenerate } from '@/server/services/llm/client';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { logStylistOutfitAudit } from '@/server/logging/stylistOutfit';
import type { GatekeeperIntent } from '../intent';
import type { StylistResult } from './schema';

const outfitCriticSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    approved: {
      type: Type.BOOLEAN,
      description: '整轮方案是否总体符合场合与技能约束。',
    },
    reason: {
      type: Type.STRING,
      description: '用中文概括通过或不通过的主要理由。',
    },
    outfit_notes: {
      type: Type.ARRAY,
      description: '分套简短备注，可空。',
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          ok: { type: Type.BOOLEAN },
          note: { type: Type.STRING },
        },
        required: ['id', 'ok', 'note'],
      },
    },
  },
  required: ['approved', 'reason'],
};

const OUTFIT_CRITIC_INSTRUCTION = `你是穿搭方案审核员。根据用户场合、特殊要求与已选技能，审核搭配师输出的方案是否合理。不要改方案，只给审核结论。

【关注点】
- 场合正式度/特殊活动是否被方案体现（例如录制、正式场合却整套过度休闲）。
- 若有风格技能名，方案气质是否明显打架。
- 待购/衣橱锚点是否出现在需要包含的方案里（输入会标明锚点）。
- 衣橱 XML 明明有候选却整套无理由全 new_item，可在 reason 指出（有合理补位则可通过）。

【输出】approved、reason；可选 outfit_notes。`;

export type OutfitCriticInput = {
  intent: GatekeeperIntent;
  userMessage: string;
  skillNames: string[];
  result: StylistResult;
  anchorSummary?: string;
  conversationId?: string;
  messageId?: string;
  signal?: AbortSignal;
};

/**
 * 异步审核 Stylist 方案，只落盘不抛错、不改主链路结果。
 */
export function scheduleStylistOutfitCritic(input: OutfitCriticInput): void {
  void runStylistOutfitCritic(input).catch((error) => {
    console.warn('[STYLIST_OUTFIT_CRITIC] unexpected failure:', error);
  });
}

async function runStylistOutfitCritic(input: OutfitCriticInput): Promise<void> {
  const outfits = (input.result.outfits ?? []).map((outfit) => ({
    id: outfit.id,
    overall_concept: outfit.overall_concept,
    selected_items: (outfit.selected_items ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      layer: item.layer,
    })),
  }));

  const base = {
    timestamp: new Date().toISOString(),
    conversationId: input.conversationId,
    messageId: input.messageId,
    userMessage: input.userMessage,
    occasion: input.intent.occasion,
    specialRequests: input.intent.special_requests,
    stylePreference: input.intent.style_preference,
    skillNames: input.skillNames,
    outfitCount: outfits.length,
  };

  try {
    const prompt = `
【用户原话】
${input.userMessage || '（无）'}

【意图】
- 请求类型: ${input.intent.request_type}
- 场合: ${input.intent.occasion || '无'}
- 特殊要求: ${input.intent.special_requests || '无'}
- 风格偏好字段: ${input.intent.style_preference || '无'}
- 本轮技能: ${input.skillNames.join(', ') || '无'}
- 锚点: ${input.anchorSummary || '无'}

【方案摘要】
${JSON.stringify(outfits, null, 2)}
`;

    if (input.signal?.aborted) {
      await logStylistOutfitAudit({
        ...base,
        approved: false,
        reason: '',
        failed: true,
        error: 'aborted before start',
      });
      return;
    }

    const response = await withRetryOn429(
      () =>
        llmGenerate({
          model: AGENT_MODELS.gatekeeper,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          systemInstruction: OUTFIT_CRITIC_INSTRUCTION,
          temperature: 0.1,
          maxTokens: 512,
          thinking: 'disabled',
          jsonSchema: outfitCriticSchema,
          // 独立 45s 超时，不绑主请求 signal，避免后台 critic 空转占满上游并发。
          signal: AbortSignal.timeout(45_000),
        }),
      { label: 'Stylist outfit critic' }
    );

    if (!response.text) {
      await logStylistOutfitAudit({
        ...base,
        approved: false,
        reason: '',
        failed: true,
        error: 'empty response',
      });
      return;
    }

    const parsed = JSON.parse(response.text) as {
      approved?: unknown;
      reason?: unknown;
      outfit_notes?: unknown;
    };
    const outfitNotes = Array.isArray(parsed.outfit_notes)
      ? parsed.outfit_notes
          .map((note) => {
            const record = note && typeof note === 'object' ? (note as Record<string, unknown>) : {};
            return {
              id: typeof record.id === 'string' ? record.id : '',
              ok: Boolean(record.ok),
              note: typeof record.note === 'string' ? record.note : '',
            };
          })
          .filter((note) => note.id)
      : undefined;

    await logStylistOutfitAudit({
      ...base,
      approved: Boolean(parsed.approved),
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      outfitNotes,
    });
  } catch (error) {
    await logStylistOutfitAudit({
      ...base,
      approved: false,
      reason: '',
      failed: true,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
