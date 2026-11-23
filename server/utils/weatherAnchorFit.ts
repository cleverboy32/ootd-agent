/**
 * 衣橱锚点 / special_requests 与实况气温冲突检测；
 * 待购单品适穿温度推断（供 purchase_pairing 三明治轴）。
 */

import type { Content } from '@google/genai';
import { itemFitsTemperature } from '@/server/utils/ragSeasonFilter';
import { formatWeatherRange, type WeatherTemperatureRange } from '@/server/utils/weatherInput';

export type TempRangeBounds = { tempMin: number | null; tempMax: number | null };

/** 劝换话术里的稳定标记，用于识别用户坚持原件的第二轮 */
export const WEATHER_MISMATCH_OFFER_MARKER = '按今天的气温用更合适的单品重新搭一套';

export const WEATHER_MISMATCH_HARD_REFUSE =
  '抱歉，坚持用不适应当下气温的单品已经超出我的搭配原则，这轮没法继续为你搭。若你愿意换成适合今天天气的单品，随时再叫我～';

export function buildWeatherMismatchOfferReply(options: {
  itemLabel: string;
  weatherCelsius: number | WeatherTemperatureRange;
  source: 'wardrobe' | 'special_requests';
}): string {
  const where =
    options.source === 'special_requests'
      ? `你特别要求的「${options.itemLabel}」`
      : `衣橱里的「${options.itemLabel}」`;
  const range = typeof options.weatherCelsius === 'number'
    ? `${options.weatherCelsius}℃`
    : formatWeatherRange(options.weatherCelsius);
  return (
    `${where}和今天约 ${range} 的天气不太匹配，硬搭容易不舒适也不好看。` +
    `要不要我${WEATHER_MISMATCH_OFFER_MARKER}？` +
    `如果仍坚持必须用这件，也请直接说，我会按原则说明无法继续搭配。`
  );
}

export function isWeatherMismatchInsist(userText: string): boolean {
  const text = userText.trim();
  if (!text) return false;
  return /坚持|还是要|非要|必须穿|就要这|我就要|不管天气|仍用这|还用这|不要换|别换单品|硬搭/.test(
    text
  );
}

export function historyHasWeatherMismatchOffer(history: Content[] | undefined): boolean {
  if (!history?.length) return false;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (turn.role !== 'model') continue;
    const text = (turn.parts ?? [])
      .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
      .join('\n');
    if (text.includes(WEATHER_MISMATCH_OFFER_MARKER)) return true;
    // 只看最近一条 model 回复
    break;
  }
  return false;
}

/**
 * 无 tempMin/Max 时从中文描述粗估适穿区间（与衣橱分析口径大致对齐）。
 * 无法判断时返回 null（不拦 / 待购则回退实况天气）。
 */
export function inferTempRangeFromGarmentText(text: string): TempRangeBounds | null {
  const t = text.trim();
  if (!t) return null;

  if (/羽绒|羽绒服|厚大衣|棉服|派克|雪地靴|加绒/.test(t)) {
    return { tempMin: null, tempMax: 12 };
  }
  if (/毛呢|厚针织|厚牛仔|连裤袜|大衣(?!.*薄)/.test(t)) {
    return { tempMin: null, tempMax: 15 };
  }
  if (/短袖|无袖|吊带|背心|热裤|短裤|迷你裙|薄纱|雪纺|亚麻短|凉鞋/.test(t)) {
    return { tempMin: 22, tempMax: null };
  }
  if (/五分裤|七分裤|短裙|薄短裙|薄半身裙|薄连衣裙|薄裙/.test(t)) {
    return { tempMin: 20, tempMax: null };
  }
  if (/薄外套|薄开衫|薄风衣|衬衫外套/.test(t)) {
    return { tempMin: 13, tempMax: 25 };
  }
  return null;
}

export function resolveItemTempRange(options: {
  tempMin?: number | null;
  tempMax?: number | null;
  textFallback?: string;
}): TempRangeBounds | null {
  const min = options.tempMin ?? null;
  const max = options.tempMax ?? null;
  if (min !== null || max !== null) return { tempMin: min, tempMax: max };
  if (options.textFallback?.trim()) return inferTempRangeFromGarmentText(options.textFallback);
  return null;
}

export function itemConflictsWithWeatherCelsius(
  item: TempRangeBounds,
  weatherCelsius: number
): boolean {
  return !itemFitsTemperature(item, weatherCelsius);
}

/** 待购轴：多件取适穿中点平均，生成 guard/提示用的伪天气文案 */
export function buildPurchaseSandwichWeather(summaries: string[]): string | null {
  const mids: number[] = [];
  for (const summary of summaries) {
    const range = inferTempRangeFromGarmentText(summary);
    if (!range) continue;
    const lo = range.tempMin ?? (range.tempMax !== null ? range.tempMax - 8 : null);
    const hi = range.tempMax ?? (range.tempMin !== null ? range.tempMin + 8 : null);
    if (lo === null || hi === null) continue;
    mids.push(Math.round((lo + hi) / 2));
  }
  if (mids.length === 0) return null;
  const mid = Math.round(mids.reduce((a, b) => a + b, 0) / mids.length);
  return `约${mid}℃（按待购单品适穿温度）`;
}

/** special_requests 里是否像在硬点名单品（而非纯颜色/气质微调） */
export function specialRequestsLooksLikeHardGarmentConstraint(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/必须|一定要|就要穿|用那|穿我|带上这|锚|指定/.test(t) && /裙|裤|衫|外套|鞋|靴|衣/.test(t)) {
    return true;
  }
  // 「必须用薄短裙」类
  return /必须.*(裙|裤|衫|外套|鞋)|一定要穿/.test(t);
}
