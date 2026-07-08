import { Content, Part } from "@google/genai";
import { Message } from '../types/message';


export const CONTEXT_TOKEN_LIMIT = 6000; // ~12000字，覆盖约12-15轮正常对话，远低于模型1M上下文上限

export function estimateTokenCount(history: Content[]): number {
  let totalToken = 0;
  for (const message of history) {
    for (const part of message.parts ?? []) {
      if (part.text) {
        totalToken += Math.floor(part.text.length / 2);
      } else if (part.inlineData) {
        totalToken += 250; // 为每张图片估算一个固定的 token 值
      }
    }
  }
  return totalToken;
}

export async function formatHistoryAsync(messages: Message[]): Promise<Content[]> {
  const historyForAI: Content[] = [];

  for (const message of messages) {
    // 1. 角色映射：将数据库角色 ('USER', 'ASSISTANT') 映射到 API 角色 ('user', 'model')
    const role = message.role === 'user' ? 'user' : 'model';
    // 如果 content 为空或不是一个数组，则跳过此消息
    if (!Array.isArray(message.content) || message.content.length === 0) {
      continue;
    }

    const apiParts: Part[] = [];

    // 2. 内容部分（Parts）转换：遍历消息中的每个内容部分
    for (const part of message.content) {
      if (part.type === 'text') {
        // 如果是文本部分，创建 text part
        apiParts.push({ text: part.content });
      } else if (part.type.startsWith('image/')) {
        // 如果是图片部分（假设 type 是 mimeType，如 'image/jpeg'）
        // 则创建 inlineData part，其中 content 是 Base64 编码的图片数据
        apiParts.push({
          inlineData: {
            mimeType: part.type,
            data: part.content,
          },
        });
      }
      // 你可以在这里添加对其他 type 的处理，例如 'video' 等
    }

    // 3. 只有在成功转换出内容部分后，才将该条消息添加到历史记录中
    if (apiParts.length > 0) {
      historyForAI.push({
        role: role,
        parts: apiParts,
      });
    }
  }

  // 打印日志以供调试，检查转换后的结构是否正确
  // console.log('[FORMAT_DEBUG] Formatted History:', JSON.stringify(historyForAI, null, 2));

  return historyForAI;
}