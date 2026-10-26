import type { Message, MessageContentPart } from '@/lib/types';
import { takePurchaseUploadUrls } from '@/lib/purchaseUploads';

/** 从用户消息 content parts（及兼容字段 imageUrl）取出文本与图片 URL */
export function extractUserMessageMedia(message: Pick<Message, 'content' | 'imageUrl'>): {
  text: string;
  imageUrl?: string;
  imageUrls: string[];
} {
  const parts = Array.isArray(message.content) ? message.content : [];
  const text =
    parts.find((p: MessageContentPart) => p.type === 'text')?.content?.trim() || '';
  const fromParts = parts
    .filter((p: MessageContentPart) => p.type === 'image')
    .map((p) => p.content?.trim())
    .filter((url): url is string => Boolean(url));
  const imageUrls = takePurchaseUploadUrls(
    fromParts.length > 0 ? fromParts : [message.imageUrl]
  );
  return { text, imageUrl: imageUrls[0], imageUrls };
}
