import { genAI } from '@/server/services/ai';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { sendEvent } from '@/server/utils/stream-helpers';
import {
  buildCopywriterTagContext,
  createCopywriterStreamSanitizer,
  sanitizeCopywriterTags,
} from '@/server/utils/copywriterTagSanitizer';
import { evaluateCopywriterOutput } from '@/server/utils/copywriterEvaluator';
import { logCopywriterAudit } from '@/server/services/copywriterAuditLogger';
import { StylistResult } from './stylistAgent';
import { GatekeeperIntent, outfitIdToLabel } from './intentTypes';

export interface CopywriterAuditMeta {
  conversationId?: string;
  messageId?: string;
}

const COPYWRITER_SYSTEM_INSTRUCTION = `
你是一个情商极高、充满时尚感和亲和力的时尚博主与明星导购 (Copywriter Agent)。
你的任务是把设计师（Stylist Agent）给出的 1 到 2 套硬核、枯燥的结构化穿搭方案，包装成温暖、有温度、排版优雅的聊天话术。

【核心文案包装规则】
1. 语气定制 (Tone Customization)：
   - 仔细阅读传入的用户个人风格定位（personal_style）。
   - 如果偏向“甜美/活泼”：多用“亲爱的”、“小仙女”、Emoji（✨, 💕, 🎀），语气活泼、温暖。
   - 如果偏向“知性/优雅/专业”：语气优雅、从容、专业，多用“您”，排版极简、大气。
   - 如果偏向“幽默/松弛”：语气风趣、像贴心闺蜜，多用网络热梗，排版轻松。
   - 默认语气：亲切、专业、充满时尚建设性。

2. 严格的占位符注入 (Strict Placeholder Injection) - 你的唯一 KPI，绝对不能出错：
   - 衣橱单品：当引用搭配师选用的衣橱单品（id 不为 'new_item'）时，你【必须】使用此精确占位符：{{W:物品ID}}
     * 从搭配师 JSON 的 selected_items.id 字段【复制粘贴】，禁止手写、改写或省略任何字符。
     * 正确示例：{{W:cmqg5ec6b0000pvs8q5kp2358}}
     * 禁止输出 [衣橱物品:...] 等其它格式，系统会自动转换。
   - 推荐新品标记：当引用新推荐的单品（id 为 'new_item'）时，你【必须】在单品名称旁加上 🛍️ 标记。
   - 效果图占位符：在【每一套】穿搭方案结尾，【必须】单独起一行写：{{IMG:方案ID}}
     * 方案 ID 从搭配师 JSON 的 outfits[].id 复制粘贴（如 {{IMG:outfit_1}}）。
     * 占位符必须单独起一行，前后各空一行。

3. 排版模板（必须遵循此结构，可微调语气但不可改变骨架）：
   - 这是【即时聊天对话】，不是书信、邮件或公文。禁止出现「展信佳」「此致敬礼」「顺祝商祺」「谨启」「惠鉴」等书信落款或套话。
   - 开场：1-2 句口语化寒暄，点出场合/天气/用户需求（不要用「尊敬的」「您好，很高兴为您服务」等客服腔）。
   - 过渡：一句引出方案，如「我为你准备了 N 套穿搭：」。
   - 每套方案用 ### 小标题 + 分层 bullet 描述单品，结尾单独一行放效果图占位符。
   - 收尾：一句轻松的互动结语即可（如「喜欢哪套？告诉我帮你微调～」），禁止书信式落款。

   【单套方案示例骨架】
   ---
   今天气温有点凉，打球前记得保暖哦！🏓 我为你准备了一套活力运动风：

   ### 🎀 方案一：粉色活力运动风

   * **内搭**：推荐你衣橱里的 {{W:物品ID}}，淡粉色甜美又有活力。
   * **下装**：搭配一条 🛍️ 灰色运动短裤，舒适好活动。
   * **鞋履**：🛍️ 白色复古德训鞋，轻盈跟脚。

   {{IMG:outfit_1}}
   ---

   【两套方案示例骨架】
   ---
   哈罗！约会的话我帮你搭了两套风格不同的 look ✨

   ### 💕 方案一：甜美裙装风
   * **连衣裙**：你衣橱里的 {{W:物品ID}} 温柔又显气质……
   * **鞋履**：🛍️ 米色高跟凉鞋，拉长腿部线条。

   {{IMG:outfit_1}}

   ---

   ### 🌟 方案二：利落裤装风
   * **上装**：{{W:物品ID}} 搭配 🛍️ 高腰阔腿裤，干练大方。

   {{IMG:outfit_2}}

   两套都喜欢的话，告诉我你更倾向哪套～
   ---

4. 格式规范：
   - 使用 Markdown：### 小标题、* bullet 分项、--- 分隔多套方案。
   - 每个穿搭层级（上装/下装/外套/鞋履等）单独一条 bullet，不要挤成一大段。
   - 不要输出任何 JSON 格式，直接输出纯 Markdown 文本。
`;

const COPYWRITER_REVISION_ADDENDUM = `
【反馈微调模式 — 当前为 revision，必须遵守】
- 这是用户对【已有方案】的修改，不是全新推荐。
- 【禁止】使用「下午好呀」「为您定制了」「我为你准备了 N 套」等全新推荐开场。
- 开场 1 句简短确认修改即可，如「好的，已在第一套里把鞋履换成高跟鞋～」。
- 【只描述 1 套】方案，小标题可用 ### 方案一（已微调）。
- 在 bullet 中点出【变更项】，其余单品简要带过。
- 收尾用「还要再调哪里吗？」，禁止「喜欢哪套？告诉我帮你微调～」。
`;

function buildCopywriterPrompt(
  stylistResult: StylistResult,
  personalStyle: string,
  intent?: GatekeeperIntent
): { prompt: string; systemInstruction: string } {
  const isRevision = intent?.request_type === 'feedback_revision';
  const revisionNote = isRevision
    ? `\n【微调上下文】\n- 目标方案: ${outfitIdToLabel(intent?.selected_outfit_id)}\n- 修改要求: ${intent?.special_requests || '无'}\n`
    : '';

  const prompt = `
【用户风格定位】
${personalStyle || '日常休闲'}
${revisionNote}
【搭配师给出的结构化方案】
${JSON.stringify(stylistResult, null, 2)}

请为以上方案进行温暖、优雅的文案润色。严格遵循占位符注入规则与排版模板，以即时聊天口吻输出，禁止书信落款。直接开始输出你的 Markdown 文本：
`;

  const systemInstruction = isRevision
    ? `${COPYWRITER_SYSTEM_INSTRUCTION}\n${COPYWRITER_REVISION_ADDENDUM}`
    : COPYWRITER_SYSTEM_INSTRUCTION;

  return { prompt, systemInstruction };
}

/**
 * 调用 Copywriter Agent 进行流式文案润色
 * @param stylistResult 搭配师输出的结构化方案
 * @param personalStyle 用户的个人风格/性格偏好
 * @param controller ReadableStreamDefaultController 用于流式推送
 * @param onData 收集完整文本的回调函数
 */
export async function callCopywriterAgentStream(
  stylistResult: StylistResult,
  personalStyle: string,
  controller: ReadableStreamDefaultController,
  onData: (text: string) => void,
  auditMeta?: CopywriterAuditMeta,
  intent?: GatekeeperIntent
): Promise<string> {
  console.log('[COPYWRITER_AGENT] Starting streaming copywriting...');

  const tagContext = buildCopywriterTagContext(stylistResult);
  const streamSanitizer = createCopywriterStreamSanitizer(tagContext);
  const { prompt, systemInstruction } = buildCopywriterPrompt(stylistResult, personalStyle, intent);

  const config = {
    systemInstruction,
    temperature: 0.7,
  };

  try {
    const responseStream = await withRetryOn429(
      () =>
        genAI.models.generateContentStream({
          model: AGENT_MODELS.copywriter,
          contents: prompt,
          config,
        }),
      { label: 'Copywriter' }
    );

    let fullText = '';

    for await (const chunk of responseStream) {
      const text = chunk.text;
      if (text) {
        const sanitized = streamSanitizer.process(text);
        if (sanitized) {
          fullText += sanitized;
          sendEvent(controller, 'text_chunk', { text: sanitized });
        }
      }
    }

    const tail = streamSanitizer.flush();
    if (tail) {
      fullText += tail;
      sendEvent(controller, 'text_chunk', { text: tail });
    }

    fullText = sanitizeCopywriterTags(fullText, tagContext);

    const l1 = evaluateCopywriterOutput(fullText, stylistResult);
    void logCopywriterAudit({
      timestamp: new Date().toISOString(),
      conversationId: auditMeta?.conversationId,
      messageId: auditMeta?.messageId,
      personalStyle,
      outfitCount: stylistResult.outfits.length,
      copywriterTextLength: fullText.length,
      l1,
      copywriterText: fullText,
    });

    console.log('[COPYWRITER_AGENT] Streaming completed. Total length:', fullText.length);

    onData(fullText);

    return fullText;
  } catch (error) {
    console.error('[COPYWRITER_AGENT] Error during copywriting stream:', error);
    throw error;
  }
}
