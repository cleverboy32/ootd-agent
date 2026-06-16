import type { ImageState } from '@/lib/types';
import type { StylistResult } from '@/app/api/generate-with-image/handlers/stylistAgent';
import type { UserProfileResult } from '@/app/api/generate-with-image/handlers/userProfileAgent';
import { ClothingItem } from '@prisma/client';

export interface StylistCacheNode {
  type: 'stylist_cache';
  stylist_result: StylistResult;
  user_profile: UserProfileResult;
  wardrobe_items: ClothingItem[];
}

export interface ImageStatesNode {
  type: 'image_states';
  states: Record<string, ImageState>;
}

export type PersistedMessagePart =
  | { type: 'text'; content: string }
  | StylistCacheNode
  | ImageStatesNode
  | Record<string, unknown>;

const IMAGE_PLACEHOLDER_RE = /\[IMAGE=([^\]]+)\]/g;

export function asContentArray(content: unknown): PersistedMessagePart[] {
  if (Array.isArray(content)) return content as PersistedMessagePart[];
  if (typeof content === 'string') return [{ type: 'text', content }];
  return [];
}

export function extractStylistCache(content: unknown): StylistCacheNode | null {
  const node = asContentArray(content).find((p) => p.type === 'stylist_cache');
  return (node as StylistCacheNode) ?? null;
}

export function extractImageStates(content: unknown): Record<string, ImageState> {
  const node = asContentArray(content).find((p) => p.type === 'image_states') as
    | ImageStatesNode
    | undefined;
  return node?.states ?? {};
}

export function extractTextContent(content: unknown): string {
  const textPart = asContentArray(content).find((p) => p.type === 'text') as
    | { type: 'text'; content: string }
    | undefined;
  return textPart?.content ?? (typeof content === 'string' ? content : '');
}

export function buildImageStates(
  outfitIds: string[],
  imageMap: Map<string, string>,
  failedImageIds: Set<string>
): Record<string, ImageState> {
  const states: Record<string, ImageState> = {};
  for (const id of outfitIds) {
    if (imageMap.has(id)) {
      states[id] = imageMap.get(id)!;
    } else if (failedImageIds.has(id)) {
      states[id] = 'failed';
    }
  }
  return states;
}

/** Apply successful image URLs to text; leave failed placeholders intact. */
export function applyImageResultsToText(
  text: string,
  imageMap: Map<string, string>
): string {
  let result = text;
  for (const [id, url] of imageMap.entries()) {
    const placeholder = `[IMAGE=${id}]`;
    const markdownImage = `\n\n![AI 生成的穿搭效果图](${url})\n\n`;
    result = result.split(placeholder).join(markdownImage);
  }
  return result;
}

export function collectOutfitIdsFromText(text: string): string[] {
  return [...text.matchAll(IMAGE_PLACEHOLDER_RE)].map((m) => m[1]);
}

export function buildPersistedMessageContent(options: {
  text: string;
  stylistCache?: StylistCacheNode | null;
  imageStates: Record<string, ImageState>;
}): PersistedMessagePart[] {
  const parts: PersistedMessagePart[] = [{ type: 'text', content: options.text }];

  if (options.stylistCache) {
    parts.push(options.stylistCache);
  }

  if (Object.keys(options.imageStates).length > 0) {
    parts.push({ type: 'image_states', states: options.imageStates });
  }

  return parts;
}

/** Patch a single outfit image into persisted message content after user retry. */
export function patchMessageImageResult(
  content: unknown,
  outfitId: string,
  imageUrl: string
): PersistedMessagePart[] {
  let text = extractTextContent(content);

  const placeholder = `[IMAGE=${outfitId}]`;
  const markdownImage = `\n\n![AI 生成的穿搭效果图](${imageUrl})\n\n`;
  if (text.includes(placeholder)) {
    text = text.split(placeholder).join(markdownImage);
  } else {
    text = text.replace(/\n\n\*\(❌ 效果图生成失败\)\*\n\n/, markdownImage);
  }

  const stylistCache = extractStylistCache(content);
  const imageStates = { ...extractImageStates(content), [outfitId]: imageUrl };

  return buildPersistedMessageContent({ text, stylistCache, imageStates });
}
