import { readCredential } from './credentials';

export const SEEDREAM_MAX_REFERENCE_IMAGES = 14;

interface SeedreamImageResponse {
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { message?: string; code?: string };
}

export function isSeedreamImageVendor(): boolean {
  const vendor = process.env.IMAGE_VENDOR?.trim().toLowerCase() || '';
  return ['bytedance', 'volc', 'ark', 'seedream'].includes(vendor);
}

export function buildSeedreamRequestBody(options: {
  prompt: string;
  model: string;
  referenceImageUrls?: string[];
  size?: string;
}): Record<string, unknown> {
  const refs = options.referenceImageUrls?.map((u) => u.trim()).filter(Boolean).slice(0, SEEDREAM_MAX_REFERENCE_IMAGES);
  const body: Record<string, unknown> = {
    model: options.model,
    prompt: options.prompt,
    size: options.size ?? '1728x2304',
    response_format: 'b64_json',
    watermark: false,
    sequential_image_generation: 'disabled',
  };
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
    return { data: first.b64_json, mimeType: 'image/jpeg' };
  }
  if (first?.url) {
    return fetchImageAsBase64(first.url);
  }

  throw new Error('Seedream image generation did not return image data.');
}
