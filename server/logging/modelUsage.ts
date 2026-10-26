import {
  priceModelUsage,
  type UsageInput,
  type UsageKind,
} from '@/server/config/modelPricing';
import { auditLogPath } from './paths';
import { appendJsonlEntry } from './jsonl';
import { currentRequestTrace } from './usageContext';

const AUDIT_LOG_PATH = auditLogPath('usage-audit.jsonl');

export interface UsageAuditEntry {
  timestamp: string;
  model: string;
  kind: UsageKind;
  cacheHitTokens: number;
  cacheMissTokens: number;
  completionTokens: number;
  embeddingTokens: number;
  generatedImages: number;
  imageOutputTokens: number;
  costCny: number | null;
  rateId: string;
  conversationId?: string;
  messageId?: string;
  clientId?: string;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw as Record<string, unknown>;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** 对话用量。DeepSeek 的缓存命中和未命中分开；没有拆分时整段输入算未命中。 */
export function readChatUsage(raw: unknown): UsageInput {
  const record = asRecord(raw);
  if (!record) {
    return { kind: 'chat', model: '', usageMissing: true };
  }

  if ('promptTokenCount' in record || 'candidatesTokenCount' in record) {
    const prompt = num(record.promptTokenCount);
    const hit = num(record.cachedContentTokenCount);
    return {
      kind: 'chat',
      model: '',
      cacheHitTokens: hit,
      cacheMissTokens: Math.max(0, prompt - hit),
      completionTokens: num(record.candidatesTokenCount),
    };
  }

  const prompt = num(record.prompt_tokens);
  const details = asRecord(record.prompt_tokens_details);
  const hasSplit =
    'prompt_cache_hit_tokens' in record ||
    'prompt_cache_miss_tokens' in record ||
    (details != null && 'cached_tokens' in details);
  const hit = num(record.prompt_cache_hit_tokens) || num(details?.cached_tokens);
  const miss = 'prompt_cache_miss_tokens' in record
    ? num(record.prompt_cache_miss_tokens)
    : Math.max(0, prompt - hit);

  if (hasSplit) {
    return {
      kind: 'chat',
      model: '',
      cacheHitTokens: hit,
      cacheMissTokens: miss,
      completionTokens: num(record.completion_tokens),
    };
  }

  return {
    kind: 'chat',
    model: '',
    cacheHitTokens: 0,
    cacheMissTokens: prompt,
    completionTokens: num(record.completion_tokens),
  };
}

/** 出图用量。成功张数用于计费，output_tokens 只留档。 */
export function readImageUsage(raw: unknown, successfulImages: number): UsageInput {
  const record = asRecord(raw);
  if (!record) {
    return {
      kind: 'image',
      model: '',
      generatedImages: successfulImages,
      imageOutputTokens: 0,
      usageMissing: successfulImages <= 0,
    };
  }

  const generatedImages = 'generated_images' in record
    ? num(record.generated_images)
    : successfulImages;
  const imageOutputTokens =
    num(record.output_tokens) || num(record.total_tokens) || num(record.totalTokenCount);

  return {
    kind: 'image',
    model: '',
    generatedImages,
    imageOutputTokens,
  };
}

export function readEmbeddingUsage(raw: unknown): UsageInput {
  const record = asRecord(raw);
  if (!record) return { kind: 'embedding', model: '', usageMissing: true };
  const hasField =
    'prompt_tokens' in record ||
    'total_tokens' in record ||
    'promptTokenCount' in record ||
    'totalTokenCount' in record;
  if (!hasField) return { kind: 'embedding', model: '', usageMissing: true };
  const embeddingTokens =
    num(record.prompt_tokens) ||
    num(record.total_tokens) ||
    num(record.promptTokenCount) ||
    num(record.totalTokenCount);
  return { kind: 'embedding', model: '', embeddingTokens };
}

/** 记一次调用。失败只打日志，不打断生成。 */
export async function recordModelUsage(input: UsageInput, at: Date = new Date()): Promise<void> {
  try {
    const priced = priceModelUsage(input, at);
    const trace = currentRequestTrace();
    const identity = trace?.auditIdentity();
    const entry: UsageAuditEntry = {
      timestamp: new Date().toISOString(),
      model: input.model,
      kind: input.kind,
      cacheHitTokens: input.cacheHitTokens ?? 0,
      cacheMissTokens: input.cacheMissTokens ?? 0,
      completionTokens: input.completionTokens ?? 0,
      embeddingTokens: input.embeddingTokens ?? 0,
      generatedImages: input.generatedImages ?? 0,
      imageOutputTokens: input.imageOutputTokens ?? 0,
      costCny: priced.costCny,
      rateId: priced.rateId,
      conversationId: identity?.conversationId,
      messageId: identity?.messageId,
      clientId: identity?.clientId,
    };
    trace?.addUsage({
      ...entry,
      costCny: priced.costCny,
    });
    console.log(
      `[USAGE_AUDIT] kind=${entry.kind} model=${entry.model} costCny=${entry.costCny ?? '-'}`
    );
    await appendJsonlEntry(AUDIT_LOG_PATH, entry, 'USAGE_AUDIT');
  } catch (error) {
    console.error('[USAGE_AUDIT] Failed to record usage:', error);
  }
}

export async function recordChatUsage(model: string, raw: unknown): Promise<void> {
  await recordModelUsage({ ...readChatUsage(raw), model });
}

export async function recordImageUsage(
  model: string,
  raw: unknown,
  successfulImages: number
): Promise<void> {
  await recordModelUsage({ ...readImageUsage(raw, successfulImages), model });
}

export async function recordEmbeddingUsage(model: string, raw: unknown): Promise<void> {
  await recordModelUsage({ ...readEmbeddingUsage(raw), model });
}
