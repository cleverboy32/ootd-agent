import { llmStream } from '@/server/services/llm/client';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { sendEvent } from '@/server/utils/stream-helpers';
import {
  buildCopywriterTagContext,
  createCopywriterStreamSanitizer,
  sanitizeCopywriterTags,
} from '@/server/utils/copywriterTagSanitizer';
import { evaluateCopywriterOutput } from '@/server/utils/copywriterEvaluator';
import { logCopywriterAudit } from '@/server/logging/copywriter';
import { StylistResult, StyleAdviceResult } from '../stylist/agent';
import { GatekeeperIntent } from '../intent';
import {
  COPYWRITER_ADVICE_SYSTEM_INSTRUCTION,
  buildCopywriterPrompt,
} from './prompts';

export type { } from './prompts';

export interface CopywriterAuditMeta {
  conversationId?: string;
  messageId?: string;
}

/**
 * 调用 Copywriter Agent（建议模式）：将 StyleAdviceResult 包装成对话文本流式输出
 */
export async function callCopywriterAdviceStream(
  advice: StyleAdviceResult,
  personalStyle: string,
  controller: ReadableStreamDefaultController,
  onData: (text: string) => void,
  _auditMeta?: CopywriterAuditMeta
): Promise<void> {
  console.log('[COPYWRITER_AGENT] Starting advice stream...');

  const pointsList = advice.points.map((p, i) => `${i + 1}. ${p}`).join('\n');
  const personalNoteBlock = advice.personal_note?.trim()
    ? `\n个性化补充: ${advice.personal_note}`
    : '';
  const followupBlock = advice.followup?.trim() ? `\n引导钩子: ${advice.followup}` : '';

  const prompt = `
【用户风格定位】
${personalStyle || '日常休闲'}

【造型师给出的结构化建议】
- 主题: ${advice.topic}
- 核心要点:
${pointsList}${personalNoteBlock}${followupBlock}

请将以上建议包装成温暖、口语化的聊天话术。使用 Markdown 排版（### 小标题 + bullet 要点）。直接开始输出你的 Markdown 文本：
`;

  try {
    const responseStream = await withRetryOn429(
      () =>
        llmStream({
          model: AGENT_MODELS.copywriter,
          contents: prompt,
          systemInstruction: COPYWRITER_ADVICE_SYSTEM_INSTRUCTION,
          temperature: 0.7,
        }),
      { label: 'Copywriter advice' }
    );

    let fullText = '';

    for await (const chunk of responseStream) {
      const text = chunk.text;
      if (text) {
        fullText += text;
        sendEvent(controller, 'text_chunk', { text });
      }
    }

    console.log('[COPYWRITER_AGENT] Advice stream completed. Length:', fullText.length);
    onData(fullText);
  } catch (error) {
    console.error('[COPYWRITER_AGENT] Error during advice stream:', error);
    throw error;
  }
}

/**
 * 调用 Copywriter Agent 进行流式文案润色
 */
export async function callCopywriterAgentStream(
  stylistResult: StylistResult,
  personalStyle: string,
  controller: ReadableStreamDefaultController,
  onData: (text: string) => void,
  auditMeta?: CopywriterAuditMeta,
  intent?: GatekeeperIntent,
  revisionNoItemChange?: boolean
): Promise<string> {
  console.log('[COPYWRITER_AGENT] Starting streaming copywriting...');

  const tagContext = buildCopywriterTagContext(stylistResult);
  const streamSanitizer = createCopywriterStreamSanitizer(tagContext);
  const { prompt, systemInstruction } = buildCopywriterPrompt(stylistResult, personalStyle, intent, revisionNoItemChange);

  try {
    const responseStream = await withRetryOn429(
      () =>
        llmStream({
          model: AGENT_MODELS.copywriter,
          contents: prompt,
          systemInstruction,
          temperature: 0.7,
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
