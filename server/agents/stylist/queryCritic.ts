import { Type, type Schema } from '@google/genai';
import { llmGenerate } from '@/server/services/llm/client';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { logWardrobeQueryAudit } from '@/server/logging/wardrobeQuery';
import { extractRetrievalSection, loadSkill } from '@/server/skills/loadSkill';
import type { GatekeeperIntent } from '../intent';
import type { WardrobeSearchQuery } from '@/server/utils/ragSearchSlots';

const queryCriticSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    approved: {
      type: Type.BOOLEAN,
      description: 'query 是否与场合/风格检索约束相符。',
    },
    reason: {
      type: Type.STRING,
      description: '用中文说明通过或不通过的理由；通过也可简短确认。',
    },
  },
  required: ['approved', 'reason'],
};

const QUERY_CRITIC_INSTRUCTION = `你是衣橱检索 query 审核员。只判断 query 列表是否贴合场合、天气档与已注入风格技能的「检索」约束，不要改写 query，不要评价衣橱有没有货。

【通过标准】
- 有天气文本与天气技能时：只审层次与厚薄（该有外套时是否有 outerwear；薄档不应出现羽绒棉服；冷档不应只有无厚度的薄开衫）。裙或裤不算天气违规。
- 有风格技能时：各槽 query 应有形态区分度，不应只有「针织衫」「薄外套」「平底鞋」等万能词；且不应明显违背风格「检索」节禁搜。
- 场合正式或特殊：不应无理由退回纯休闲默认（例如无理由只搜运动鞋）；应能看出正式度或活动所需品类。
- 不要求 query 原样包含场合原词；应看品类说法是否合理。

【输出】approved + reason（中文）。`;

export type QueryCriticInput = {
  intent: GatekeeperIntent;
  userMessage: string;
  searchSkillNames: string[];
  queries: WardrobeSearchQuery[];
  conversationId?: string;
  messageId?: string;
  signal?: AbortSignal;
};

function styleRetrievalBrief(skillNames: string[]): string {
  const styleNames = skillNames.filter((name) => name.startsWith('style-'));
  if (styleNames.length === 0) return '（无风格技能）';
  return styleNames
    .map((name) => {
      try {
        const section = extractRetrievalSection(loadSkill(name));
        return `【${name} 检索】\n${section || '（无检索节）'}`;
      } catch {
        return `【${name} 检索】\n（无法加载）`;
      }
    })
    .join('\n\n');
}

/**
 * 异步审核 wardrobe search queries，只落盘不抛错、不改主链路结果。
 */
export function scheduleWardrobeQueryCritic(input: QueryCriticInput): void {
  void runWardrobeQueryCritic(input).catch((error) => {
    console.warn('[WARDROBE_QUERY_CRITIC] unexpected failure:', error);
  });
}

async function runWardrobeQueryCritic(input: QueryCriticInput): Promise<void> {
  const queries = input.queries.map((item) => ({
    slot: item.slot,
    query: item.query,
  }));
  const base = {
    timestamp: new Date().toISOString(),
    conversationId: input.conversationId,
    messageId: input.messageId,
    userMessage: input.userMessage,
    occasion: input.intent.occasion,
    specialRequests: input.intent.special_requests,
    stylePreference: input.intent.style_preference,
    skillNames: input.searchSkillNames,
    queries,
  };

  try {
    const prompt = `
【用户原话】
${input.userMessage || '（无）'}

【意图】
- 场合: ${input.intent.occasion || '无'}
- 天气: ${input.intent.weather || '无'}
- 特殊要求: ${input.intent.special_requests || '无'}
- 风格偏好字段: ${input.intent.style_preference || '无'}
- 本轮检索技能: ${input.searchSkillNames.join(', ') || '无'}

【风格技能检索约束】
${styleRetrievalBrief(input.searchSkillNames)}

【待审 query】
${JSON.stringify(queries, null, 2)}
`;

    if (input.signal?.aborted) {
      await logWardrobeQueryAudit({
        ...base,
        kind: 'query_critic',
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
          systemInstruction: QUERY_CRITIC_INSTRUCTION,
          temperature: 0.1,
          maxTokens: 320,
          thinking: 'disabled',
          jsonSchema: queryCriticSchema,
          // 独立 45s 超时，不绑主请求 signal，避免后台 critic 空转占满上游并发。
          signal: AbortSignal.timeout(45_000),
        }),
      { label: 'Wardrobe query critic' }
    );

    if (!response.text) {
      await logWardrobeQueryAudit({
        ...base,
        kind: 'query_critic',
        failed: true,
        error: 'empty response',
      });
      return;
    }

    const parsed = JSON.parse(response.text) as { approved?: unknown; reason?: unknown };
    await logWardrobeQueryAudit({
      ...base,
      kind: 'query_critic',
      approved: Boolean(parsed.approved),
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    });
  } catch (error) {
    await logWardrobeQueryAudit({
      ...base,
      kind: 'query_critic',
      failed: true,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
