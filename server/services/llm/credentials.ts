import type { LlmCapability } from './types';

const VENDOR_ENV: Record<LlmCapability, string> = {
  chat: 'LLM_VENDOR',
  image: 'IMAGE_VENDOR',
  embedding: 'EMBEDDING_VENDOR',
};

const CAPABILITY_KEY_ENV: Record<LlmCapability, { key: string; baseUrl: string }> = {
  chat: { key: 'LLM_API_KEY', baseUrl: 'LLM_BASE_URL' },
  image: { key: 'IMAGE_API_KEY', baseUrl: 'IMAGE_BASE_URL' },
  embedding: { key: 'EMBEDDING_API_KEY', baseUrl: 'EMBEDDING_BASE_URL' },
};

const DEFAULT_BASE_URL: Record<string, string> = {
  kimi: 'https://api.moonshot.cn/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  bytedance: 'https://ark.cn-beijing.volces.com/api/v3',
  volc: 'https://ark.cn-beijing.volces.com/api/v3',
  ark: 'https://ark.cn-beijing.volces.com/api/v3',
};

export function vendorPrefix(vendor: string): string {
  return vendor.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

export function readCredential(capability: LlmCapability): { apiKey: string; baseURL?: string } {
  const vendor = process.env[VENDOR_ENV[capability]]?.trim();
  if (vendor) {
    const prefix = vendorPrefix(vendor);
    const apiKey = process.env[`${prefix}_API_KEY`]?.trim();
    if (!apiKey) {
      throw new Error(`${prefix}_API_KEY is missing (LLM_VENDOR/IMAGE_VENDOR/EMBEDDING_VENDOR=${vendor}).`);
    }
    const baseURL =
      process.env[`${prefix}_BASE_URL`]?.trim() ||
      DEFAULT_BASE_URL[vendor.toLowerCase()];
    return { apiKey, baseURL };
  }

  const { key, baseUrl } = CAPABILITY_KEY_ENV[capability];
  const apiKey = process.env[key]?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      `${key} (or OPENAI_API_KEY / ${VENDOR_ENV[capability]}) is missing. Set a key for ${capability}.`
    );
  }
  const baseURL =
    process.env[baseUrl]?.trim() || process.env.OPENAI_BASE_URL?.trim() || undefined;
  return { apiKey, baseURL };
}
