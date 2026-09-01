import { llmEmbed } from './llm/client';
import { getProvider } from './llm/provider';
import { Part } from '@google/genai';

const useVertex = getProvider('embedding') === 'vertex';

export const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL?.trim() ||
  (useVertex ? 'gemini-embedding-001' : 'ep-20260831113153-7hkg7');
/** gemini-embedding-001 / text-embedding-3-large 均可 3072 维；换模型族后必须重建衣橱向量 */
export const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS) || (useVertex ? 3072 : 2048);

export interface EmbeddingSimilarityThresholds {
  /** DB 层最低召回门槛 */
  search: number;
  /** 槽位评估：低于此值为 weak */
  slotWeak: number;
  /** 槽位评估：高于此值为 adequate */
  slotAdequate: number;
  /** 灰区提升：top1 - top2 ≥ 此 gap 时，可将 weak 提升为 adequate */
  slotConfidenceGap: number;
  /** wardrobe_pairing 锚定：高于此值且领先时可 auto-resolve */
  resolveThreshold: number;
  /** wardrobe_pairing 锚定：高于此值进入 ambiguous 候选展示 */
  ambiguousMin: number;
}

function isByteDanceEmbeddingVendor(): boolean {
  const vendor = process.env.EMBEDDING_VENDOR?.trim().toLowerCase() || '';
  return ['bytedance', 'volc', 'ark'].includes(vendor);
}

/**
 * text RAG 相似度阈值（textEmbedding 列）。
 * 不同 embedding 模型族的 cosine 分数刻度不同，不能跨模型复用。
 */
export function getTextSimilarityThresholds(): EmbeddingSimilarityThresholds {
  const provider = getProvider('embedding');
  if (provider === 'vertex' && !isByteDanceEmbeddingVendor()) {
    return {
      search: 0.5,
      slotWeak: 0.58,
      slotAdequate: 0.66,
      slotConfidenceGap: 0.04,
      resolveThreshold: 0.72,
      ambiguousMin: 0.58,
    };
  }
  // Doubao text RAG：MainCategory 对齐后 top1 常见 0.60–0.74（2026-08-31 回放均值 ~0.63）
  return {
    search: 0.48,
    slotWeak: 0.55,
    slotAdequate: 0.62,
    slotConfidenceGap: 0.04,
    resolveThreshold: 0.68,
    ambiguousMin: 0.55,
  };
}

/** @deprecated 使用 getTextSimilarityThresholds */
export function getEmbeddingSimilarityThresholds(): EmbeddingSimilarityThresholds {
  return getTextSimilarityThresholds();
}

function extractImageHint(image: Part): string {
  const mime = image.inlineData?.mimeType;
  return mime ? `[image:${mime}]` : '';
}

/** 文本 RAG：query 与 text document 共用 */
export async function generateTextEmbedding(text: string): Promise<number[]> {
  try {
    return await llmEmbed(text, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS);
  } catch (error) {
    console.error('[TEXT_EMBED] Error in generateTextEmbedding:', error);
    throw error;
  }
}

/** 图搜图预留：图文混合 document 向量 */
export async function generateVisualEmbedding(
  text: string,
  imageUrl: string
): Promise<number[]> {
  try {
    if (useVertex) {
      console.log('[VISUAL_EMBED] Generating visual embedding (Vertex multimodal)...');
      return await llmEmbed(text, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, { text: '' }, imageUrl);
    }
    console.log('[VISUAL_EMBED] Generating visual embedding (ByteDance vision + image URL)...');
    return await llmEmbed(text, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, { text: '' }, imageUrl);
  } catch (error) {
    console.error('[VISUAL_EMBED] Error in generateVisualEmbedding:', error);
    throw error;
  }
}

export async function generateQueryEmbedding(text: string): Promise<number[]> {
  return generateTextEmbedding(text);
}

export async function generateDocumentEmbedding(
  text: string,
  image: Part,
  imageUrl?: string
): Promise<number[]> {
  try {
    if (imageUrl?.trim()) {
      return generateVisualEmbedding(text, imageUrl);
    }
    console.log('[EmbeddingService] Generating document embedding (text-only)...');
    const withHint = [text, extractImageHint(image)].filter(Boolean).join('\n');
    return generateTextEmbedding(withHint);
  } catch (error) {
    console.error('Error in generateDocumentEmbedding:', error);
    throw error;
  }
}

/** @deprecated 使用 generateTextEmbedding */
export async function generateEmbedding(text: string): Promise<number[]> {
  return generateTextEmbedding(text);
}

/** @deprecated 使用 generateVisualEmbedding */
export async function generateMultimodalEmbedding(text: string, image: Part): Promise<number[]> {
  return generateDocumentEmbedding(text, image);
}
