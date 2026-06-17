import { genAI } from './ai';
import { Part } from '@google/genai';

export const EMBEDDING_MODEL = 'gemini-embedding-001';
/** gemini-embedding-001 默认 3072 维，且已 L2 归一化，适合余弦相似度 */
export const EMBEDDING_DIMENSIONS = 3072;

const embedConfig = {
  outputDimensionality: EMBEDDING_DIMENSIONS,
} as const;

function extractEmbeddingValues(result: Awaited<ReturnType<typeof genAI.models.embedContent>>): number[] {
  if (!result.embeddings || result.embeddings.length === 0) {
    throw new Error('The AI service returned an empty embedding response.');
  }

  const embedding = result.embeddings[0];
  if (!embedding.values) {
    throw new Error("Embedding object is missing 'values'.");
  }

  return embedding.values;
}

/**
 * 检索 query 用 embedding（RETRIEVAL_QUERY）
 */
export async function generateQueryEmbedding(text: string): Promise<number[]> {
  try {
    const result = await genAI.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
      config: {
        ...embedConfig,
        taskType: 'RETRIEVAL_QUERY',
      },
    });

    return extractEmbeddingValues(result);
  } catch (error) {
    console.error('Error in generateQueryEmbedding:', error);
    throw error;
  }
}

/**
 * 衣橱单品入库用 embedding（RETRIEVAL_DOCUMENT + 图片）
 */
export async function generateDocumentEmbedding(text: string, image: Part): Promise<number[]> {
  try {
    console.log('[EmbeddingService] Generating document embedding (multimodal)...');
    const result = await genAI.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: {
        parts: [{ text }, image],
      },
      config: {
        ...embedConfig,
        taskType: 'RETRIEVAL_DOCUMENT',
      },
    });

    console.log('[EmbeddingService] Document embedding generated successfully.');
    return extractEmbeddingValues(result);
  } catch (error) {
    console.error('Error in generateDocumentEmbedding:', error);
    throw error;
  }
}

/** @deprecated 使用 generateQueryEmbedding 或 generateDocumentEmbedding */
export async function generateEmbedding(text: string): Promise<number[]> {
  return generateQueryEmbedding(text);
}

/** @deprecated 使用 generateDocumentEmbedding */
export async function generateMultimodalEmbedding(text: string, image: Part): Promise<number[]> {
  return generateDocumentEmbedding(text, image);
}
