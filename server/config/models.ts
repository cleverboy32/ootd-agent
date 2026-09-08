/**
 * 各 Agent 使用的模型配置。
 *
 * 后端：LLM_PROVIDER=openai | vertex（IMAGE_PROVIDER / EMBEDDING_PROVIDER 可单独覆盖）
 * OpenAI 兼容：LLM_API_KEY + LLM_BASE_URL（未配则 OPENAI_*）
 * Vertex：PROJECT_ID + LOCATION + ADC
 */
import { getProvider } from '@/server/services/llm/provider';

const useVertexChat = getProvider('chat') === 'vertex';
const useVertexImage = getProvider('image') === 'vertex';

const openaiChat = process.env.LLM_MODEL?.trim() || 'deepseek-v4-pro';

const VERTEX_DEFAULTS = {
  gatekeeper: 'gemini-3.1-flash-lite',
  copywriter: 'gemini-3.5-flash',
  visualPrompt: 'gemini-2.5-flash-lite',
  visualCritic: 'gemini-2.5-pro',
  imageGen: 'gemini-3.1-flash-image',
  stylist: 'gemini-2.5-pro',
  userProfile: 'gemini-2.5-pro',
  summarization: 'gemini-3.1-flash-lite',
  reasoning: 'gemini-2.5-pro',
  wardrobeAnalysis: 'gemini-2.5-flash',
} as const;

function chatModel(
  envName: string,
  vertexDefault: string
): string {
  return process.env[envName]?.trim() || (useVertexChat ? vertexDefault : openaiChat);
}

export const AGENT_MODELS = {
  gatekeeper: chatModel('LLM_MODEL_GATEKEEPER', VERTEX_DEFAULTS.gatekeeper),
  copywriter: chatModel('LLM_MODEL_COPYWRITER', VERTEX_DEFAULTS.copywriter),
  visualPrompt: chatModel('LLM_MODEL_VISUAL_PROMPT', VERTEX_DEFAULTS.visualPrompt),
  visualCritic: chatModel('LLM_MODEL_VISUAL_CRITIC', VERTEX_DEFAULTS.visualCritic),
  imageGen:
    process.env.LLM_MODEL_IMAGE?.trim() ||
    (useVertexImage ? VERTEX_DEFAULTS.imageGen : 'doubao-seedream-4-0-250828'),
  stylist: chatModel('LLM_MODEL_STYLIST', VERTEX_DEFAULTS.stylist),
  userProfile: chatModel('LLM_MODEL_USER_PROFILE', VERTEX_DEFAULTS.userProfile),
  summarization: chatModel('LLM_MODEL_SUMMARIZATION', VERTEX_DEFAULTS.summarization),
  reasoning: chatModel('LLM_MODEL_REASONING', VERTEX_DEFAULTS.reasoning),
  wardrobeAnalysis: chatModel('LLM_MODEL_WARDROBE_ANALYSIS', VERTEX_DEFAULTS.wardrobeAnalysis),
} as const;

/** 视觉导演画图最大并发数 */
export const IMAGE_GEN_CONCURRENCY = 2;

/** 图片生成退避重试（与旧版 generateImage.ts 一致） */
export const IMAGE_GEN_RETRY = {
  retries: 2,
  minTimeoutMs: 2000,
  factor: 2,
} as const;
