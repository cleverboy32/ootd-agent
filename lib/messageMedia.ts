import type { Message, MessageContentPart } from '@/lib/types';

/** 从用户消息 content parts（及兼容字段 imageUrl）取出文本与图片 URL */
export function extractUserMessageMedia(message: Pick<Message, 'content' | 'imageUrl'>): {
  text: string;
  imageUrl?: string;
} {
  const parts = Array.isArray(message.content) ? message.content : [];
  const text =
    parts.find((p: MessageContentPart) => p.type === 'text')?.content?.trim() || '';
  const imageFromParts = parts.find((p: MessageContentPart) => p.type === 'image')?.content?.trim();
  const imageUrl = imageFromParts || message.imageUrl?.trim() || undefined;
  return { text, imageUrl };
}
