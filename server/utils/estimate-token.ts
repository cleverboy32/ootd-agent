import { Content, Part } from "@google/genai";
import { urlToGenerativePart } from "./image";
import { Message } from '../types/message';


export const CONTEXT_TOKEN_LIMIT = 1000; // 为模型最大值留出一些余地

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
    if (!messages || messages.length === 0) {
      return [];
    }
    const history: Content[] = [];
  
    for (const msg of messages) {
      let role = msg.role;
      if (role !== 'user' && role !== 'model' && role !== 'ai') continue;
      if (role === 'ai') role = 'model';
  
      // 1. 从数据库解析出我们的自定义 Part 数组
      let dbParts: { type: string, content: string }[] = [];
      try {
        const content = msg.content;
        if (Array.isArray(content)) {
          dbParts = content.filter(
            (p) => p && typeof p.type === 'string' && typeof p.content === 'string'
          ) as { type: string; content: string }[];
        } else if (typeof content === 'string') {
          dbParts = [{ type: 'text', content: content }];
        }
      } catch (e) {
        console.error("无法解析数据库中的消息 content:", msg.content, e);
        continue;
      }
      
      // 2. 将自定义 dbParts 数组转换成官方的 SDK Part[] 数组
      const sdkParts: Part[] = [];
      for (const dbPart of dbParts) {
        if (dbPart.type === 'text' && typeof dbPart.content === 'string') {
          // 创建一个只包含 `text` 属性的有效 Part
          sdkParts.push({ text: dbPart.content });
        } else if (dbPart.type === 'image' && typeof dbPart.content === 'string' && dbPart.content.startsWith('http')) {
          try {
            // 调用工具函数，它会返回一个只包含 `inlineData` 属性的有效 Part
            const imagePart = await urlToGenerativePart(dbPart.content);
            sdkParts.push(imagePart);
          } catch (e) {
            console.error(`无法处理历史图片URL: ${dbPart.content}`, e);
            // 这里可以选择跳过这个坏掉的图片，或者添加一个错误提示文本
            sdkParts.push({ text: `[图片加载失败: ${dbPart.content}]` });
          }
        }
        // 在这里可以扩展以处理其他类型的 dbPart
      }
  
      if (sdkParts.length === 0) continue;
  
      // 3. 合并或添加到最终的 history 数组中
      if (history.length > 0 && history[history.length - 1].role === role) {
        const lastMessage = history[history.length - 1];
        if (lastMessage && lastMessage.parts) {
          lastMessage.parts.push(...sdkParts);
        } else if (lastMessage) {
          lastMessage.parts = sdkParts;
        }
      } else {
        history.push({ role, parts: sdkParts });
      }
    }
    
    if (history.length > 0 && history[0].role === 'model') history.shift();
    return history;
  }