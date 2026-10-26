import { GoogleGenAI, Modality, type Part, type Schema } from '@google/genai';
import { throwIfAborted } from '@/server/utils/abort';
import { normalizeContents } from './convert';
import { recordChatUsage, recordEmbeddingUsage, recordImageUsage } from '@/server/logging/modelUsage';
import type { LlmGenerateOptions, LlmGenerateResult } from './types';

let cached: GoogleGenAI | null = null;

export function getVertexClient(): GoogleGenAI {
  if (cached) return cached;
  const project = process.env.PROJECT_ID?.trim();
  const location = process.env.LOCATION?.trim();
  if (!project || !location) {
    throw new Error('Vertex requires PROJECT_ID and LOCATION (plus ADC credentials).');
  }
  cached = new GoogleGenAI({
    vertexai: true,
    project,
    location,
  });
  return cached;
}

export async function vertexGenerate(options: LlmGenerateOptions): Promise<LlmGenerateResult> {
  throwIfAborted(options.signal);
  const genAI = getVertexClient();
  const response = await genAI.models.generateContent({
    model: options.model,
    contents: normalizeContents(options.contents),
    config: {
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      responseMimeType: options.jsonSchema ? 'application/json' : undefined,
      responseSchema: options.jsonSchema as Schema | undefined,
    },
  });
  const text = response.text ?? '';
  await recordChatUsage(options.model, response.usageMetadata);
  return { text };
}

export async function vertexStream(
  options: Omit<LlmGenerateOptions, 'jsonSchema'>
): Promise<AsyncGenerator<{ text: string }>> {
  throwIfAborted(options.signal);
  const genAI = getVertexClient();
  const stream = await genAI.models.generateContentStream({
    model: options.model,
    contents: normalizeContents(options.contents),
    config: {
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
    },
  });

  async function* iterate() {
    let usage: unknown;
    try {
      for await (const chunk of stream) {
        throwIfAborted(options.signal);
        if (chunk.usageMetadata) usage = chunk.usageMetadata;
        const text = chunk.text;
        if (text) yield { text };
      }
    } finally {
      await recordChatUsage(options.model, usage);
    }
  }

  return iterate();
}

export async function vertexGenerateImage(
  parts: Part[],
  model: string
): Promise<{ data: string; mimeType: string }> {
  const genAI = getVertexClient();
  const response = await genAI.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: {
      responseModalities: [Modality.IMAGE],
      imageConfig: {
        aspectRatio: '3:4',
        imageSize: '1K',
      },
    },
  });
  const imagePart = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  const data = imagePart?.inlineData?.data;
  const mimeType = imagePart?.inlineData?.mimeType;
  if (!data || !mimeType) {
    throw new Error('Image generation API did not return image data.');
  }
  await recordImageUsage(model, response.usageMetadata, 1);
  return { data, mimeType };
}

export async function vertexEmbed(
  text: string,
  model: string,
  dimensions: number,
  image?: Part
): Promise<number[]> {
  const genAI = getVertexClient();
  const result = await genAI.models.embedContent({
    model,
    contents: image ? { parts: [{ text }, image] } : text,
    config: {
      outputDimensionality: dimensions,
      taskType: image ? 'RETRIEVAL_DOCUMENT' : 'RETRIEVAL_QUERY',
    },
  });
  const values = result.embeddings?.[0]?.values;
  if (!values?.length) {
    throw new Error('The AI service returned an empty embedding response.');
  }
  const usage = (result as { usageMetadata?: unknown }).usageMetadata;
  await recordEmbeddingUsage(model, usage);
  return values;
}
