import { genAI } from './ai';
import { Part } from '@google/genai';

/**
 * Generates a vector embedding for a given text.
 * @param text The text to be converted into an embedding.
 * @returns A promise that resolves to an array of numbers (the vector).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const result = await genAI.models.embedContent({
      model: 'gemini-embedding-001',
      contents: text,
    });

    // [FIXED] Handle the response safely and idiomatically, as per the official examples.
    if (!result.embeddings || result.embeddings.length === 0) {
      throw new Error("Failed to generate embedding: The AI service returned an empty or invalid response.");
    }

    // The API returns an array of embeddings. For this function, we only need the first one.
    const embedding = result.embeddings[0];

    if (!embedding.values) {
      throw new Error("Failed to generate embedding: Embedding object is missing 'values'.");
    }
    
    return embedding.values;

  } catch (error) {
    console.error("Error in generateEmbedding:", error);
    throw new Error("Failed to generate text embedding from the AI service.");
  }
}

/**
 * [NEW] Generates a single, high-quality vector embedding from a combination of text and an image.
 * @param text The descriptive text context for the image.
 * @param image The image part (mimeType and base64 data).
 * @returns A promise that resolves to an array of numbers (the multimodal vector).
 */
export async function generateMultimodalEmbedding(text: string, image: Part): Promise<number[]> {
  try {
    console.log('[EmbeddingService] Generating multimodal embedding...');
    const result = await genAI.models.embedContent({
      model: 'gemini-embedding-001',
      contents: {
        parts: [
          { text: text },
          image
        ]
      }
    });

    // [FIXED] Handle the response safely and idiomatically, as per the official examples.
    if (!result.embeddings || result.embeddings.length === 0) {
      throw new Error("Failed to generate multimodal embedding: The AI service returned an empty or invalid response.");
    }

    // The API returns an array of embeddings. For this function, we only need the first one.
    const embedding = result.embeddings[0];

    if (!embedding.values) {
      throw new Error("Failed to generate multimodal embedding: Embedding object is missing 'values'.");
    }

    console.log('[EmbeddingService] Multimodal embedding generated successfully.');
    return embedding.values;

  } catch (error) {
    console.error("Error in generateMultimodalEmbedding:", error);
    throw new Error("Failed to generate multimodal embedding from the AI service.");
  }
}
