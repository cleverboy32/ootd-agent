import { Content, Part } from '@google/genai';
import { Message } from '../types/message';
import {
  extractStylistCache,
  formatStylistResultForHistory,
} from './messageContent';

export const CONTEXT_TOKEN_LIMIT = 500000; // 远低于模型1M上下文上限

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
    const stylistCache = role === 'model' ? extractStylistCache(message.content) : null;
    const outfitHistoryText = stylistCache
      ? formatStylistResultForHistory(stylistCache.stylist_result)
      : '';

    // 2. 内容部分（Parts）转换：有搭配 cache 时用精简方案结构替换文案散文
    for (const part of message.content) {
      if (part.type === 'text') {
        if (outfitHistoryText) continue;
        if (typeof part.content === 'string' && part.content.length > 0) {
          apiParts.push({ text: part.content });
        }
      } else if (part.type === 'stylist_cache') {
        // 已在循环外抽出；此处跳过，避免重复
        continue;
      } else if (part.type === 'wardrobe_candidates') {
        // Keep candidate ids in model history so verbal confirm can bind to the shown item.
        const ids = (part.items ?? [])
          .map((item) => (typeof item?.id === 'string' ? item.id.trim() : ''))
          .filter(Boolean);
        if (ids.length > 0) {
          apiParts.push({ text: `[wardrobe_candidates:id=${ids.join(',')}]` });
        }
      } else if (part.type.startsWith('image/') && typeof part.content === 'string') {
        // 如果是图片部分（假设 type 是 mimeType，如 'image/jpeg'）
        // 则创建 inlineData part，其中 content 是 Base64 编码的图片数据
        apiParts.push({
          inlineData: {
            mimeType: part.type,
            data: part.content,
          },
        });
      }
    }

    if (outfitHistoryText) {
      apiParts.unshift({ text: outfitHistoryText });
    }

    // 3. 只有在成功转换出内容部分后，才将该条消息添加到历史记录中
    if (apiParts.length > 0) {
      historyForAI.push({
        role,
        parts: apiParts,
      });
    }
  }

  return historyForAI;
}
