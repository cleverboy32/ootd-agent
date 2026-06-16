/**
 * 各 Agent 使用的模型配置。
 * 分散到不同模型池，避免单模型 burst 触发 429。
 */
export const AGENT_MODELS = {
  gatekeeper: 'gemini-3.1-flash-lite',
  copywriter: 'gemini-3.5-flash',
  visualPrompt: 'gemini-2.5-flash-lite',
  visualCritic: 'gemini-2.5-pro',
  imageGen: 'gemini-2.5-flash-image',
  stylist: 'gemini-2.5-pro',
  userProfile: 'gemini-2.5-pro',
  summarization: 'gemini-3.1-flash-lite',
  reasoning: 'gemini-2.5-pro',
} as const;

/** 视觉导演画图最大并发数（flash-image 配额独立且较紧） */
export const IMAGE_GEN_CONCURRENCY = 2;

/** 图片生成退避重试（与旧版 generateImage.ts 一致） */
export const IMAGE_GEN_RETRY = {
  retries: 2,
  minTimeoutMs: 2000,
  factor: 2,
} as const;
