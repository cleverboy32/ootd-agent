import OpenAI from 'openai';
import type { Part } from '@google/genai';
import {
  contentsToOpenAIMessages,
  extractJsonText,
  googleSchemaToJsonSchema,
} from './convert';
import type { LlmCapability, LlmGenerateOptions, LlmGenerateResult, LlmProvider } from './types';
import { getProvider } from './provider';
import { readCredential } from './credentials';
import { minimaxGenerateImage } from './minimax';
import { bytedanceMultimodalEmbed, usesByteDanceMultimodalEmbedding } from './bytedance';
import { isSeedreamImageVendor, seedreamGenerateImage } from './seedream';
import {
  vertexEmbed,
  vertexGenerate,
  vertexGenerateImage,
  vertexStream,
} from './vertex';

export type { LlmGenerateOptions, LlmGenerateResult, LlmProvider };
export { getProvider };

const clients: Partial<Record<LlmCapability, OpenAI>> = {};

export function getClient(capability: LlmCapability): OpenAI {
  const cached = clients[capability];
  if (cached) return cached;
  const { apiKey, baseURL } = readCredential(capability);
  const client = new OpenAI({ apiKey, baseURL });
  clients[capability] = client;
  return client;
}

function buildMessages(options: LlmGenerateOptions) {
  let system = options.systemInstruction;
  if (options.jsonSchema) {
    const schemaJson = JSON.stringify(googleSchemaToJsonSchema(options.jsonSchema), null, 2);
    system = `${system?.trim() ?? ''}\n\nYou MUST reply with a single JSON object matching this schema. No markdown.\n${schemaJson}`.trim();
  }
  return contentsToOpenAIMessages(options.contents, system);
}

export function resolveChatTemperature(model: string, requested?: number): number | undefined {
  const vendor = process.env.LLM_VENDOR?.trim().toLowerCase();
  if (
    vendor === 'kimi' ||
    vendor === 'moonshot' ||
    model.toLowerCase().startsWith('kimi-')
  ) {
    return 1;
  }
  return requested;
}

function isResponseFormatCompatibilityError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as {
    message?: unknown;
    error?: { message?: unknown; param?: unknown };
    param?: unknown;
  };
  const message = String(record.error?.message ?? record.message ?? '').toLowerCase();
  const param = String(record.error?.param ?? record.param ?? '').toLowerCase();
  return (
    param.includes('response_format') ||
    message.includes('response_format') ||
    message.includes('json_object') ||
    message.includes('json mode')
  );
}

export async function llmGenerate(options: LlmGenerateOptions): Promise<LlmGenerateResult> {
  if (getProvider('chat') === 'vertex') {
    return vertexGenerate(options);
  }

  const client = getClient('chat');
  const messages = buildMessages(options);
  const base = {
    model: options.model,
    temperature: resolveChatTemperature(options.model, options.temperature),
    messages,
  };

  try {
    const completion = await client.chat.completions.create({
      ...base,
      response_format: options.jsonSchema ? { type: 'json_object' as const } : undefined,
    });
    const text = completion.choices[0]?.message?.content ?? '';
    return { text: options.jsonSchema ? extractJsonText(text) : text };
  } catch (error) {
    if (!options.jsonSchema || !isResponseFormatCompatibilityError(error)) throw error;
    console.warn('[LLM] json_object response_format not supported, retrying without it');
    const completion = await client.chat.completions.create(base);
    const text = completion.choices[0]?.message?.content ?? '';
    return { text: extractJsonText(text) };
  }
}

export async function llmStream(
  options: Omit<LlmGenerateOptions, 'jsonSchema'>
): Promise<AsyncGenerator<{ text: string }>> {
  if (getProvider('chat') === 'vertex') {
    return vertexStream(options);
  }

  const client = getClient('chat');
  const stream = await client.chat.completions.create({
    model: options.model,
    temperature: resolveChatTemperature(options.model, options.temperature),
    messages: buildMessages(options),
    stream: true,
  });

  async function* iterate() {
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) yield { text };
    }
  }

  return iterate();
}

export async function llmGenerateImage(
  prompt: string,
  model: string,
  parts?: Part[],
  referenceImageUrls?: string[]
): Promise<{ data: string; mimeType: string }> {
  if (getProvider('image') === 'vertex') {
    const vertexParts = parts?.length ? parts : [{ text: prompt }];
    return vertexGenerateImage(vertexParts, model);
  }

  if (isSeedreamImageVendor()) {
    return seedreamGenerateImage({ prompt, model, referenceImageUrls });
  }

  if (process.env.IMAGE_VENDOR?.trim().toLowerCase() === 'minimax') {
    return minimaxGenerateImage(prompt, model);
  }

  const client = getClient('image');
  const size = process.env.IMAGE_SIZE?.trim() || '1024x1024';
  try {
    const result = await client.images.generate({
      model,
      prompt,
      size,
      response_format: 'b64_json',
    });
    const data = result.data?.[0]?.b64_json;
    if (data) return { data, mimeType: 'image/png' };
  } catch (error) {
    console.warn('[LLM] images.generate with b64_json failed, retrying without response_format', error);
  }

  const result = await client.images.generate({ model, prompt, size });
  const data = result.data?.[0]?.b64_json;
  if (data) return { data, mimeType: 'image/png' };
  throw new Error('Image generation API did not return image data.');
}

export async function llmEmbed(
  text: string,
  model: string,
  dimensions: number,
  image?: Part,
  imageUrl?: string
): Promise<number[]> {
  if (getProvider('embedding') === 'vertex') {
    return vertexEmbed(text, model, dimensions, image);
  }

  if (usesByteDanceMultimodalEmbedding(model)) {
    return bytedanceMultimodalEmbed({ text, model, dimensions, imageUrl });
  }

  const client = getClient('embedding');
  try {
    const result = await client.embeddings.create({
      model,
      input: text,
      dimensions,
    });
    const values = result.data[0]?.embedding;
    if (values?.length) return values;
  } catch (error) {
    console.warn('[LLM] embeddings with dimensions failed, retrying without dimensions', error);
  }

  const result = await client.embeddings.create({ model, input: text });
  const values = result.data[0]?.embedding;
  if (!values?.length) {
    throw new Error('The AI service returned an empty embedding response.');
  }
  return values;
}
