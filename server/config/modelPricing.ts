/**
 * 价目版本。DeepSeek 对话单价来自官方价格页（2026-10-23）：
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * 单位是人民币 / 百万 tokens。
 *
 * 高峰：北京时间周一至周五 9:00–12:00、14:00–18:00。
 * 周末全天空闲。中国法定节假日官方也算空闲，这里没有节假日表，
 * 落在周一至周五的节假日会按高峰估价。
 *
 * 出图按成功张数计费，不乘 output_tokens。当前接入点 id 不在价目里，费用留空。
 * 向量同样只在价目能对上型号时折算。
 */
export const MODEL_PRICE_RATE_ID = 'deepseek-cny-2026-10-23';

const PER_MILLION = 1_000_000;

export type UsageKind = 'chat' | 'image' | 'embedding';

export interface UsageInput {
  kind: UsageKind;
  model: string;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  completionTokens?: number;
  embeddingTokens?: number;
  generatedImages?: number;
  imageOutputTokens?: number;
  /** 响应里没有用量字段，不能当成 0 元 */
  usageMissing?: boolean;
}

export interface PricedUsage {
  costCny: number | null;
  rateId: string;
}

interface ChatRates {
  hit: number;
  miss: number;
  output: number;
}

const FLASH_MODELS = new Set([
  'deepseek-flash',
  'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
]);

const PRO_MODELS = new Set(['deepseek-v4-pro']);

const FLASH_OFF: ChatRates = { hit: 0.02, miss: 1, output: 4 };
const FLASH_PEAK: ChatRates = { hit: 0.04, miss: 2, output: 8 };
const PRO_OFF: ChatRates = { hit: 0.15, miss: 4.5, output: 13.5 };
const PRO_PEAK: ChatRates = { hit: 0.3, miss: 9, output: 27 };

/** 已知的按张人民币单价。空着表示这个型号还不能折算。 */
const IMAGE_CNY_PER_SUCCESS = new Map<string, number>();

/** 已知的向量人民币 / 百万 tokens。空着表示这个型号还不能折算。 */
const EMBEDDING_CNY_PER_MILLION = new Map<string, number>();

export function roundCny(value: number): number {
  return Math.round(value * PER_MILLION) / PER_MILLION;
}

/** 出图费用只看成功张数。 */
export function priceImageCostCny(generatedImages: number, yuanPerImage: number): number {
  return roundCny(generatedImages * yuanPerImage);
}

export function isDeepseekPeak(at: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(at);
  const weekday = parts.find((part) => part.type === 'weekday')?.value;
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (!Number.isInteger(hour)) return false;
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
}

function chatRates(model: string, at: Date): ChatRates | null {
  const name = model.trim().toLowerCase();
  const peak = isDeepseekPeak(at);
  if (FLASH_MODELS.has(name)) return peak ? FLASH_PEAK : FLASH_OFF;
  if (PRO_MODELS.has(name)) return peak ? PRO_PEAK : PRO_OFF;
  return null;
}

export function priceModelUsage(input: UsageInput, at: Date = new Date()): PricedUsage {
  if (input.usageMissing) {
    return { costCny: null, rateId: MODEL_PRICE_RATE_ID };
  }

  if (input.kind === 'image') {
    const yuanPerImage = IMAGE_CNY_PER_SUCCESS.get(input.model.trim().toLowerCase());
    if (yuanPerImage == null) return { costCny: null, rateId: MODEL_PRICE_RATE_ID };
    return {
      costCny: priceImageCostCny(input.generatedImages ?? 0, yuanPerImage),
      rateId: MODEL_PRICE_RATE_ID,
    };
  }

  if (input.kind === 'embedding') {
    const yuanPerMillion = EMBEDDING_CNY_PER_MILLION.get(input.model.trim().toLowerCase());
    if (yuanPerMillion == null) return { costCny: null, rateId: MODEL_PRICE_RATE_ID };
    return {
      costCny: roundCny(((input.embeddingTokens ?? 0) * yuanPerMillion) / PER_MILLION),
      rateId: MODEL_PRICE_RATE_ID,
    };
  }

  const rates = chatRates(input.model, at);
  if (!rates) return { costCny: null, rateId: MODEL_PRICE_RATE_ID };
  const cost =
    ((input.cacheHitTokens ?? 0) * rates.hit +
      (input.cacheMissTokens ?? 0) * rates.miss +
      (input.completionTokens ?? 0) * rates.output) /
    PER_MILLION;
  return { costCny: roundCny(cost), rateId: MODEL_PRICE_RATE_ID };
}
