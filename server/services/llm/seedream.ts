import { recordImageUsage } from '@/server/logging/modelUsage';
import { readCredential } from './credentials';

export const SEEDREAM_MAX_REFERENCE_IMAGES = 14;
/** Seedream 5.0 多图生图上限更紧（文档 2–10） */
const SEEDREAM_5_MAX_REFERENCE_IMAGES = 10;

interface SeedreamImageResponse {
  data?: Array<{ url?: string; b64_json?: string }>;
  usage?: {
    generated_images?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; code?: string };
}

export function isSeedreamImageVendor(): boolean {
  const vendor = process.env.IMAGE_VENDOR?.trim().toLowerCase() || '';
  return ['bytedance', 'volc', 'ark', 'seedream'].includes(vendor);
}

/** Seedream 5.0 pro/flash：不支持 sequential_image_generation，参考图上限也更低 */
export function isSeedream5Model(model: string): boolean {
  return /seedream-5-0/i.test(model);
}

export function buildSeedreamRequestBody(options: {
  prompt: string;
  model: string;
  referenceImageUrls?: string[];
  size?: string;
}): Record<string, unknown> {
  const isV5 = isSeedream5Model(options.model);
  const maxRefs = isV5 ? SEEDREAM_5_MAX_REFERENCE_IMAGES : SEEDREAM_MAX_REFERENCE_IMAGES;
  const refs = options.referenceImageUrls?.map((u) => u.trim()).filter(Boolean).slice(0, maxRefs);
  const body: Record<string, unknown> = {
    model: options.model,
    prompt: options.prompt,
    size: options.size ?? '1728x2304',
    response_format: 'b64_json',
    watermark: false,
  };
  // 4.x 用 disabled 锁单图；5.0 文档写明不支持配置该字段
  if (!isV5) {
    body.sequential_image_generation = 'disabled';
  }
  if (refs?.length) {
    body.image = refs.length === 1 ? refs[0] : refs;
  }
  return body;
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch Seedream image URL: ${response.status}`);
  }
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
  const buffer = Buffer.from(await response.arrayBuffer());
  return { data: buffer.toString('base64'), mimeType };
}

export async function seedreamGenerateImage(options: {
  prompt: string;
  model: string;
  referenceImageUrls?: string[];
}): Promise<{ data: string; mimeType: string }> {
  const { apiKey, baseURL } = readCredential('image');
  const base = (baseURL ?? 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
  const size = process.env.IMAGE_SIZE?.trim() || '1728x2304';

  const body = buildSeedreamRequestBody({
    prompt: options.prompt,
    model: options.model,
    referenceImageUrls: options.referenceImageUrls,
    size,
  });

  const refCount = Array.isArray(body.image) ? body.image.length : body.image ? 1 : 0;
  console.log(
    `[SEEDREAM] Generating image model=${options.model} refs=${refCount} size=${size} promptLen=${options.prompt.length}`
  );

  const response = await fetch(`${base}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as SeedreamImageResponse;
  if (!response.ok) {
    const detail = payload.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`Seedream image generation failed: ${detail}`);
  }

  const first = payload.data?.[0];
  if (first?.b64_json) {
    await recordImageUsage(options.model, payload.usage, 1);
    return { data: first.b64_json, mimeType: 'image/jpeg' };
  }
  if (first?.url) {
    const image = await fetchImageAsBase64(first.url);
    await recordImageUsage(options.model, payload.usage, 1);
    return image;
  }

  throw new Error('Seedream image generation did not return image data.');
}
