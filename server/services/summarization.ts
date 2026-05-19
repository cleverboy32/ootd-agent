import { genAI } from 'server/services/ai';
import { Content } from '@google/genai';

const summarizationInstruction = `你是一个对话摘要机器人。
    你的任务是将一段“之前的摘要”和“新的对话内容”合并，生成一个更新后的、更全面的摘要。
    新的摘要将作为记忆提供给另一个 AI。请保留所有关键信息，如用户的姓名、个人信息、已经做出的决定和核心诉T求。
    请以一个客观的、第三人称的视角进行总结。

    例如：
    之前的摘要：用户李明，身高180cm。
    新的对话：用户表示想找适合晚宴的西装，偏好深色系。
    你的输出：用户李明，身高180cm，正在寻找适合晚宴的深色系西装。`;

/**
 * Generates a new, updated summary based on a previous summary and new conversation content.
 * @param previousSummary The content of the last known summary. Can be null.
 * @param newMessages The new messages that have occurred since the last summary.
 * @returns A promise that resolves to the new summary content string, or null if generation fails.
 */
export async function generateSummary(
  previousSummary: string | null,
  newMessages: Content[]
): Promise<string | null> {
  try {
    if (newMessages.length === 0) {
      return previousSummary; // 如果没有新消息，无需重新生成摘要
    }

    
    const newMessagesText = newMessages
      .map(msg => {
        const textParts = (msg.parts ?? []).map(part => part.text || '').join(' ');
        return `${msg.role}: ${textParts}`;
      })
      .join('\n');

      const fullPrompt = `
      ${summarizationInstruction}
      
      --- 之前的摘要 ---
      ${previousSummary || '无'}
      
      --- 新的对话内容 ---
      ${newMessagesText}
      
      --- 请生成更新后的摘要 ---`;

    const result = await genAI.models.generateContent({
        model: "gemini-2.5-flash", // 确认模型名称
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        });
      
    // --- [核心修改] --- 更健壮、类型安全的响应解析
    const firstCandidate = result.candidates?.[0];
    if (
      firstCandidate &&
      firstCandidate.content &&
      Array.isArray(firstCandidate.content.parts) &&
      firstCandidate.content.parts.length > 0
    ) {
      const firstPart = firstCandidate.content.parts[0];
      if (firstPart.text) {
        return firstPart.text; // 成功提取到文本，返回 string
      }
    }

    // 如果以上任何一步失败，都意味着没有有效的文本返回
    console.warn("Summary generation returned no valid text content.");
    return null; // 返回 null，符合函数签名
  } catch (error) {
    console.error('Failed to generate summary:', error);
    return null;
  }
}
