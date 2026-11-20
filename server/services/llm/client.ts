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
import { throwIfAborted } from '@/server/utils/abort';
import { appendJsonlEntry } from '@/server/logging/jsonl';
import { auditLogPath } from '@/server/logging/paths';
import { recordChatUsage, recordEmbeddingUsage, recordImageUsage } from '@/server/logging/modelUsage';
import { currentRequestTrace } from '@/server/logging/usageContext';
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

function readMessageContent(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .join('');
  }
  return '';
}

/** finish_reason=length 时抬输出预算，给正文留额度（reasoning 与 content 共用 max_tokens）。 */
const EMPTY_CONTENT_RETRY_MAX_TOKENS = 16_384;
const EMPTY_CONTENT_AUDIT_PATH = auditLogPath('llm-empty-content.jsonl');

function logEmptyContent(completion: {
  choices?: Array<{ finish_reason?: string | null; message?: unknown }>;
  usage?: { completion_tokens?: number | null } | null;
}): void {
  const choice = completion.choices?.[0];
  const message = choice?.message as { reasoning_content?: unknown } | undefined;
  const reasoning = message?.reasoning_content;
  const reasoningLen =
    typeof reasoning === 'string'
      ? reasoning.length
      : reasoning == null
        ? 0
        : String(reasoning).length;
  console.warn('[LLM] empty message.content', {
    finish_reason: choice?.finish_reason ?? null,
    completion_tokens: completion.usage?.completion_tokens ?? null,
    reasoning_content_len: reasoningLen,
  });
}

function recordEmptyContentEvent(entry: {
  model: string;
  finishReason: string | null;
  retryAction: string;
  recovered: boolean;
}): void {
  const identity = currentRequestTrace()?.auditIdentity();
  console.warn('[LLM] empty-content retry', entry);
  void appendJsonlEntry(
    EMPTY_CONTENT_AUDIT_PATH,
    {
      timestamp: new Date().toISOString(),
      ...entry,
      conversationId: identity?.conversationId,
      messageId: identity?.messageId,
      clientId: identity?.clientId,
    },
    'LLM_EMPTY_CONTENT'
  );
}

type LlmGenerateAttempt = {
  text: string;
  finishReason: string | null;
};

export async function llmGenerate(options: LlmGenerateOptions): Promise<LlmGenerateResult> {
  throwIfAborted(options.signal);
  if (getProvider('chat') === 'vertex') {
    return vertexGenerate(options);
  }

  const client = getClient('chat');
  const messages = buildMessages(options);
  const requestOptions = options.signal ? { signal: options.signal } : undefined;

  const runOnce = async (
    thinking: LlmGenerateOptions['thinking'] | undefined,
    useJsonResponseFormat: boolean,
    maxTokens?: number
  ): Promise<LlmGenerateAttempt> => {
    const thinkingBody =
      thinking != null ? { thinking: { type: thinking } } : {};
    const completion = await client.chat.completions.create(
      {
        model: options.model,
        temperature: resolveChatTemperature(options.model, options.temperature),
        messages,
        ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
        response_format:
          useJsonResponseFormat && options.jsonSchema
            ? { type: 'json_object' as const }
            : undefined,
        ...thinkingBody,
      },
      requestOptions
    );
    await recordChatUsage(options.model, completion.usage);
    const raw = readMessageContent(completion.choices[0]?.message);
    const finishReason = completion.choices[0]?.finish_reason ?? null;
    if (!raw.trim()) {
      logEmptyContent(completion);
    }
    return {
      text: options.jsonSchema ? extractJsonText(raw) : raw,
      finishReason,
    };
  };

  const recoverEmptyContent = async (
    first: LlmGenerateAttempt,
    useJsonResponseFormat: boolean
  ): Promise<string> => {
    if (first.text.trim()) return first.text;

    // 1) 思考占满输出预算 → 抬 max_tokens 再试（仍开 thinking）
    if (first.finishReason === 'length') {
      const bumped = Math.max(options.maxTokens ?? 0, EMPTY_CONTENT_RETRY_MAX_TOKENS);
      const bumpedAttempt = await runOnce(
        options.thinking,
        useJsonResponseFormat,
        bumped
      );
      const recovered = Boolean(bumpedAttempt.text.trim());
      recordEmptyContentEvent({
        model: options.model,
        finishReason: first.finishReason,
        retryAction: `max_tokens=${bumped}`,
        recovered,
      });
      if (recovered) return bumpedAttempt.text;
    }

    // 2) content_filter / tool_calls / stop / 未知：关 thinking 再试一轮（均落盘记录）
    if (options.thinking !== 'disabled') {
      const disabled = await runOnce(
        'disabled',
        useJsonResponseFormat,
        options.maxTokens
      );
      const recovered = Boolean(disabled.text.trim());
      recordEmptyContentEvent({
        model: options.model,
        finishReason: first.finishReason,
        retryAction: 'thinking_disabled',
        recovered,
      });
      return disabled.text;
    }

    recordEmptyContentEvent({
      model: options.model,
      finishReason: first.finishReason,
      retryAction: 'none',
      recovered: false,
    });
    return first.text;
  };

  try {
    const first = await runOnce(options.thinking, true, options.maxTokens);
    return { text: await recoverEmptyContent(first, true) };
  } catch (error) {
    if (!options.jsonSchema || !isResponseFormatCompatibilityError(error)) throw error;
    console.warn('[LLM] json_object response_format not supported, retrying without it');
    const first = await runOnce(options.thinking, false, options.maxTokens);
    return { text: await recoverEmptyContent(first, false) };
  }
}

export async function llmStream(
  options: Omit<LlmGenerateOptions, 'jsonSchema'>
): Promise<AsyncGenerator<{ text: string }>> {
  throwIfAborted(options.signal);
  if (getProvider('chat') === 'vertex') {
    return vertexStream(options);
  }

  const client = getClient('chat');
  const stream = await client.chat.completions.create(
    {
      model: options.model,
      temperature: resolveChatTemperature(options.model, options.temperature),
      messages: buildMessages(options),
      stream: true,
      stream_options: { include_usage: true },
    },
    options.signal ? { signal: options.signal } : undefined
  );

  async function* iterate() {
    let usage: unknown;
    try {
      for await (const chunk of stream) {
        throwIfAborted(options.signal);
        if (chunk.usage) usage = chunk.usage;
        const text = chunk.choices[0]?.delta?.content;
        if (text) yield { text };
      }
    } finally {
      await recordChatUsage(options.model, usage);
    }
  }

  return iterate();
}

export async function llmGenerateImage(
  prompt: string,
  model: string,
  parts?: Part[],
  referenceImageUrls?: string[],
  signal?: AbortSignal
): Promise<{ data: string; mimeType: string }> {
  throwIfAborted(signal);
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
    const result = await client.images.generate(
      {
        model,
        prompt,
        size,
        response_format: 'b64_json',
      },
      signal ? { signal } : undefined
    );
    const data = result.data?.[0]?.b64_json;
    if (data) {
      await recordImageUsage(model, result.usage, 1);
      return { data, mimeType: 'image/png' };
    }
  } catch (error) {
    console.warn('[LLM] images.generate with b64_json failed, retrying without response_format', error);
  }

  const result = await client.images.generate(
    { model, prompt, size },
    signal ? { signal } : undefined
  );
  const data = result.data?.[0]?.b64_json;
  if (data) {
    await recordImageUsage(model, result.usage, 1);
    return { data, mimeType: 'image/png' };
  }
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
    if (values?.length) {
      await recordEmbeddingUsage(model, result.usage);
      return values;
    }
  } catch (error) {
    console.warn('[LLM] embeddings with dimensions failed, retrying without dimensions', error);
  }

  const result = await client.embeddings.create({ model, input: text });
  const values = result.data[0]?.embedding;
  if (!values?.length) {
    throw new Error('The AI service returned an empty embedding response.');
  }
  await recordEmbeddingUsage(model, result.usage);
  return values;
}
