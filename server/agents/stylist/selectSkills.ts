import { Type, type Schema } from '@google/genai';
import { llmGenerate } from '@/server/services/llm/client';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { mergeAbortSignals } from '@/server/utils/abort';
import { logStylistSkillsAudit } from '@/server/logging/stylist';
import type { GatekeeperIntent } from '../intent';
import type { UserProfileResult } from '../user-profile/agent';
import {
  listStylistSelectableSkills,
  normalizeStylistSkillNames,
  type StylistSkillProfile,
} from './skillSelection';

const selectSkillsSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    skill_names: {
      type: Type.ARRAY,
      description: '本轮要注入的搭配技能名，必须全部来自白名单；可以为空。',
      items: { type: Type.STRING },
    },
  },
  required: ['skill_names'],
};

export const SELECT_STYLIST_SKILLS_INSTRUCTION = `你是穿搭助手的技能调度。根据用户原话、本轮意图和用户档案，从白名单里选出本轮需要注入的搭配技能。

【硬规则】
- 只输出白名单里的 name；可多选场景/身形/色彩；风格 skill 最多 1 个，没有明确风格诉求就不要选风格。
- 不要为了凑数挂技能；没有依据就返回空数组。

【风格】
- style-guofeng：用户要汉服形制、马面裙、明/唐/宋制，或明确古风/国风穿成一套形制时再选。练功、上课、日常去跳舞不等于汉服；未点名形制不要挂。
- 其他风格 skill：用户点名，或档案 personal_style / suited_style 明确对应时再选。场合词不等于风格（通勤场合≠必须 style-commute）。

【场景】
- athletic-outfit：需要大幅度活动、训练、球类、瑜伽等再选。气质向舞蹈/演出若已挂形制风格，不要叠运动 skill。
- weather-dressing：上下文有可用实况天气（今天/明天温度雨雪等）再选；纯季节购物且没有可用气温时不要选。
- outfit-design：用户要买、看新品或入手时再选。

【身形与色彩】
- body / color：档案或用户原话里有身形、显高、肤色冷暖、配色诉求时再选；没有就空着。
- 梨形与苹果形不要同时选；冷暖中性肤色 undertone 最多选一个。

白名单每项的 description 只说明何时选，细则以以上原则为准。`;

export type SelectStylistSkillsOptions = {
  signal?: AbortSignal;
  conversationId?: string;
  messageId?: string;
};

function profileForSkills(profile: UserProfileResult | StylistSkillProfile): StylistSkillProfile {
  return {
    body_shape: profile.body_shape,
    height: 'height' in profile ? profile.height : undefined,
    skin_tone: profile.skin_tone,
    personal_style: profile.personal_style,
    suited_style: profile.suited_style,
  };
}

/**
 * Stylist 选搭配 skill。失败或空结果返回 []，不回退正则注入。
 */
export async function selectStylistSkills(
  intent: GatekeeperIntent,
  userMessage: string,
  profile: UserProfileResult | StylistSkillProfile,
  options: SelectStylistSkillsOptions = {}
): Promise<string[]> {
  const catalog = listStylistSelectableSkills();
  const skillProfile = profileForSkills(profile);
  const catalogText = catalog
    .map((entry) => `- ${entry.name}：${entry.description || '（无描述）'}`)
    .join('\n');

  const prompt = `
【白名单】
${catalogText}

【用户当前消息】
${userMessage || '（无文字）'}

【本轮意图】
- 请求类型: ${intent.request_type}
- 天气: ${intent.weather || '无'}
- 场合: ${intent.occasion || '无'}
- 风格偏好: ${intent.style_preference || '无'}
- 特殊要求: ${intent.special_requests || '无'}

【用户档案摘要】
- 身高: ${skillProfile.height || '未提供'}
- 身形: ${skillProfile.body_shape || '未分析'}
- 肤色: ${skillProfile.skin_tone || '未分析'}
- 个人风格: ${skillProfile.personal_style || '未分析'}
- 适合的风格: ${skillProfile.suited_style || '未判断'}

请输出 skill_names。
`;

  const baseAudit = {
    timestamp: new Date().toISOString(),
    conversationId: options.conversationId,
    messageId: options.messageId,
    userMessage,
    requestType: intent.request_type,
    occasion: intent.occasion ?? '',
    weather: intent.weather ?? '',
    stylePreference: intent.style_preference ?? '',
    specialRequests: intent.special_requests ?? '',
  };

  try {
    // 短 JSON 调度：跟 Gatekeeper 同档 flash，避免占 stylist pro 空转。
    const model = AGENT_MODELS.gatekeeper;
    const timeoutMs = 20_000;
    const signal = mergeAbortSignals(options.signal, AbortSignal.timeout(timeoutMs));

    console.log(`[STYLIST_SKILLS] Selecting skills via LLM model=${model} timeoutMs=${timeoutMs}`);
    const response = await withRetryOn429(
      () =>
        llmGenerate({
          model,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          systemInstruction: SELECT_STYLIST_SKILLS_INSTRUCTION,
          temperature: 0.2,
          maxTokens: 256,
          // DeepSeek 默认 thinking 会与 max_tokens 抢预算，导致 content 空、skill 全空。
          thinking: 'disabled',
          jsonSchema: selectSkillsSchema,
          signal,
        }),
      { label: 'Stylist select skills' }
    );

    const responseText = response.text;
    if (!responseText) {
      void logStylistSkillsAudit({
        ...baseAudit,
        rawSkillNames: [],
        skillNames: [],
        failed: true,
        error: 'empty response',
      });
      return [];
    }

    const parsed = JSON.parse(responseText) as { skill_names?: unknown };
    const raw = Array.isArray(parsed.skill_names)
      ? parsed.skill_names.filter((item): item is string => typeof item === 'string')
      : [];
    const names = normalizeStylistSkillNames(raw);
    console.log(`[STYLIST_SKILLS] Selected: ${names.join(', ') || '(none)'}`);
    void logStylistSkillsAudit({
      ...baseAudit,
      rawSkillNames: raw,
      skillNames: names,
    });
    return names;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timedOut =
      (error instanceof Error && error.name === 'TimeoutError') ||
      /aborted|timeout/i.test(message);
    console.warn(
      `[STYLIST_SKILLS] ${timedOut ? 'timed out' : 'failed'}, continuing with no skills:`,
      message
    );
    void logStylistSkillsAudit({
      ...baseAudit,
      rawSkillNames: [],
      skillNames: [],
      failed: true,
      error: timedOut ? `timeout: ${message}` : message,
    });
    return [];
  }
}
