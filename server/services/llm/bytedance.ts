import { readCredential } from './credentials';

type MultimodalInput =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface ByteDanceMultimodalEmbedResponse {
  data?: {
    embedding?: number[];
  };
  error?: {
    message?: string;
    code?: string;
  };
}

export function usesByteDanceMultimodalEmbedding(model: string): boolean {
  const vendor = process.env.EMBEDDING_VENDOR?.trim().toLowerCase();
  if (!vendor || !['bytedance', 'volc', 'ark'].includes(vendor)) return false;
  const normalized = model.trim().toLowerCase();
  return normalized.startsWith('ep-') || normalized.includes('embedding-vision');
}

export async function bytedanceMultimodalEmbed(options: {
  text: string;
  model: string;
  dimensions: number;
  imageUrl?: string;
}): Promise<number[]> {
  const { apiKey, baseURL } = readCredential('embedding');
  const base = (baseURL ?? 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
  const input: MultimodalInput[] = [{ type: 'text', text: options.text }];
  if (options.imageUrl?.trim()) {
    input.push({ type: 'image_url', image_url: { url: options.imageUrl.trim() } });
  }

  const response = await fetch(`${base}/embeddings/multimodal`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      input,
      encoding_format: 'float',
      dimensions: options.dimensions,
    }),
  });

  const payload = (await response.json()) as ByteDanceMultimodalEmbedResponse;
  if (!response.ok) {
    const detail = payload.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(detail);
  }

  const values = payload.data?.embedding;
  if (!values?.length) {
    throw new Error('ByteDance multimodal embedding returned an empty vector.');
  }
  return values;
}
