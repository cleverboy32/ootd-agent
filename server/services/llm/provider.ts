import type { LlmCapability, LlmProvider } from './types';

const capabilityProviderEnv: Record<LlmCapability, string> = {
  chat: 'LLM_PROVIDER',
  image: 'IMAGE_PROVIDER',
  embedding: 'EMBEDDING_PROVIDER',
};

export function getProvider(capability: LlmCapability): LlmProvider {
  const specific = process.env[capabilityProviderEnv[capability]]?.trim().toLowerCase();
  const fallback = process.env.LLM_PROVIDER?.trim().toLowerCase();
  const value = specific || fallback || 'openai';
  return value === 'vertex' ? 'vertex' : 'openai';
}
