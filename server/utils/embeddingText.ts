import type { GatekeeperIntent } from '@/server/agents/intent';
import type { WardrobeSearchSlot } from '@/server/utils/ragSearchSlots';
import { parseWardrobeSearchSlot, resolveMainCategoryForSlot } from '@/server/utils/ragSearchSlots';
import { extractQueryEmbeddingColors } from '@/server/utils/queryColorMatch';
import type { ClothingMainCategory } from '@prisma/client';

/** 与入库时 text embedding 文本字段顺序保持一致，便于 query/document 向量对齐 */
export interface WardrobeDocumentEmbeddingFields {
  /** DB mainCategory 枚举，如 BOTTOM / TOP */
  mainCategory?: ClothingMainCategory | string;
  subCategory: string;
  /** 一句话视觉描述（UI 展示同源） */
  description: string;
  /** 检索主段落；缺省时回退为 description */
  searchDescription?: string;
  colors?: string[];
  tags?: string[];
  season?: string[];
  material?: string[];
  occasions?: string[];
  formality?: string;
  silhouette?: string[];
}

const SLOT_CATEGORY_HINT: Record<WardrobeSearchSlot, string> = {
  top: 'top',
  inner_top: 'top',
  bottom: 'bottom',
  inner_bottom: 'bottom',
  skirt: 'skirt',
  shoes: 'footwear',
  outerwear: 'outerwear',
  legwear: 'legwear',
  accessory: 'accessory',
};

function joinField(values: string[]): string {
  return values.map(stripEmbeddingTemperatures).filter(Boolean).join(', ');
}

// Plan 和历史描述里也可能含有适穿温区。只在生成向量文本时清理它。
const temperatureNumber = String.raw`(?:零下|[+−-])?\d{1,2}(?:\.\d+)?`;
const celsiusUnit = String.raw`(?:摄氏度|℃|°\s*C|度(?!角|旋转))`;
const temperatureRange = String.raw`${temperatureNumber}(?:\s*${celsiusUnit}?\s*(?:到|至|[-−–—~～])\s*${temperatureNumber})?`;
const temperaturePrefix = String.raw`(?:TempSuitable\s*[:：]|(?:单件|单穿)?(?:适穿温度|适合温度|温度适合|体感温度|温度|适穿|适合|气温)\s*[:：为]?)`;
const celsiusExpression = new RegExp(
  String.raw`(?<![\d.])(?:${temperaturePrefix}\s*)?(?:大约|约)?(?:不低于|不超过|低于|高于|[≥≤<>])?\s*${temperatureRange}\s*${celsiusUnit}(?:以上|以下|左右)?(?:单穿|气温)?`,
  'gi'
);

export function stripEmbeddingTemperatures(text: string): string {
  const stripped = text.replace(celsiusExpression, ' ');
  if (stripped === text) return text.trim();
  return stripped
    .replace(/^\s*[,，;；。.]+\s*/, '')
    .replace(/\s*([，,；;])\s*(?=[，,；;。.]|$)/g, '')
    .replace(/\s+([，,；;。.])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

interface BuildEmbeddingTextOptions {
  /** query 侧省略空字段，避免 Visual: . 这类噪声 */
  omitEmptyFields?: boolean;
}

function buildWardrobeEmbeddingText(
  fields: WardrobeDocumentEmbeddingFields,
  options: BuildEmbeddingTextOptions = {}
): string {
  const {
    mainCategory,
    subCategory,
    description,
    searchDescription,
    colors = [],
    tags = [],
    season = [],
    material = [],
    occasions = [],
    formality,
    silhouette = [],
  } = fields;

  const visualDescription = stripEmbeddingTemperatures(description);
  const retrievalDescription = stripEmbeddingTemperatures(searchDescription ?? '') || visualDescription;
  const { omitEmptyFields = false } = options;
  const mainCategoryLabel = mainCategory?.toString().trim();

  const segments: Array<string | null> = [
    mainCategoryLabel ? `MainCategory: ${mainCategoryLabel}.` : null,
    `Category: ${stripEmbeddingTemperatures(subCategory)}.`,
    retrievalDescription ? `Description: ${retrievalDescription}.` : null,
    visualDescription || !omitEmptyFields ? `Visual: ${visualDescription}.` : null,
    colors.length || !omitEmptyFields ? `Colors: ${joinField(colors)}.` : null,
    tags.length || !omitEmptyFields ? `Tags: ${joinField(tags)}.` : null,
    occasions.length || !omitEmptyFields ? `Occasions: ${joinField(occasions)}.` : null,
    formality?.trim() || !omitEmptyFields ? `Formality: ${stripEmbeddingTemperatures(formality ?? '')}.` : null,
    silhouette.length || !omitEmptyFields ? `Silhouette: ${joinField(silhouette)}.` : null,
    season.length || !omitEmptyFields ? `Season: ${joinField(season)}.` : null,
    material.length || !omitEmptyFields ? `Material: ${joinField(material)}.` : null,
  ];

  return segments.filter(Boolean).join(' ');
}

/** 衣橱单品 textEmbedding 入库用的完整格式化文本 */
export function buildWardrobeDocumentEmbeddingText(
  fields: WardrobeDocumentEmbeddingFields
): string {
  return buildWardrobeEmbeddingText(fields);
}

export interface WardrobeQueryEmbeddingContext {
  slot?: WardrobeSearchSlot;
  intent?: GatekeeperIntent;
}

function inferSeasonFromIntent(intent?: GatekeeperIntent): string[] {
  if (!intent) return [];

  const climate = intent.dressing_climate?.trim().toLowerCase();
  if (climate === 'warm') return ['summer'];
  if (climate === 'cold') return ['winter', 'autumn'];
  if (climate === 'mild') return ['spring', 'autumn'];

  const weather = intent.weather.trim();
  if (/夏|热|高温|summer/i.test(weather)) return ['summer'];
  if (/冬|冷|寒|snow|winter/i.test(weather)) return ['winter'];
  if (/春|秋|spring|autumn|fall/i.test(weather)) return ['spring', 'autumn'];

  return [];
}

function inferTagsFromIntent(intent?: GatekeeperIntent): string[] {
  if (!intent) return [];
  const tags = [intent.occasion, intent.style_preference]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return [...new Set(tags)];
}

function inferOccasionsFromIntent(intent?: GatekeeperIntent): string[] {
  if (!intent?.occasion?.trim()) return [];
  return [intent.occasion.trim().toLowerCase()];
}

function inferMainCategoryFromQuery(
  query: string,
  slot?: WardrobeSearchSlot
): ClothingMainCategory | undefined {
  if (slot) return resolveMainCategoryForSlot(slot);

  const hintToSlot: Partial<Record<string, WardrobeSearchSlot>> = {
    top: 'top',
    bottom: 'bottom',
    skirt: 'skirt',
    dress: 'skirt',
    footwear: 'shoes',
    outerwear: 'outerwear',
    legwear: 'legwear',
    accessory: 'accessory',
  };
  const inferredSlot = hintToSlot[resolveCategoryHint(query)];
  return inferredSlot ? resolveMainCategoryForSlot(inferredSlot) : undefined;
}

/** query Category 用 slot/关键词 hint；MainCategory 与 DB 枚举对齐 */
function resolveQueryCategoryLabel(query: string, slot?: WardrobeSearchSlot): string {
  return resolveCategoryHint(query, slot);
}

/**
 * Stylist 检索 query：与 document 同结构；注入可识别颜色。
 */
export function buildWardrobeQueryEmbeddingText(
  query: string,
  context: WardrobeQueryEmbeddingContext = {}
): string {
  const normalizedQuery = query.trim();
  const category = resolveQueryCategoryLabel(normalizedQuery, context.slot);
  const mainCategory = inferMainCategoryFromQuery(normalizedQuery, context.slot);
  const season = inferSeasonFromIntent(context.intent);
  const tags = inferTagsFromIntent(context.intent);
  const occasions = inferOccasionsFromIntent(context.intent);
  const colors = extractQueryEmbeddingColors(normalizedQuery);

  return buildWardrobeEmbeddingText({
    mainCategory,
    subCategory: category,
    description: '',
    searchDescription: normalizedQuery,
    colors,
    tags,
    occasions,
    season,
    material: [],
  }, { omitEmptyFields: true });
}

function resolveCategoryHint(query: string, slot?: WardrobeSearchSlot | string): string {
  const parsedSlot = slot ? parseWardrobeSearchSlot(String(slot)) : undefined;
  if (parsedSlot) return SLOT_CATEGORY_HINT[parsedSlot];

  const normalized = query.trim().toLowerCase();
  if (/dress|gown|skirt|连衣裙|半身裙|礼服|裙/i.test(normalized)) return 'skirt';
  if (/shirt|blouse|top|tee|sweater|cardigan|short sleeve|衬衫|上衣|针织|背心|短袖/i.test(normalized)) return 'top';
  if (/pant|trouser|jean|\bshorts\b|bottom|裤|短裤/i.test(normalized)) return 'bottom';
  if (/shoe|sneaker|boot|heel|footwear|sandal|loafer|slipper|鞋|靴/i.test(normalized)) return 'footwear';
  if (/jacket|coat|outerwear|blazer|外套|夹克|大衣|风衣|开衫/i.test(normalized)) return 'outerwear';
  if (/tights|pantyhose|stockings|socks|legwear|打底袜|连裤袜|长筒袜|丝袜|袜/i.test(normalized)) {
    return 'legwear';
  }
  if (/earring|necklace|bag|belt|scarf|accessory|耳环|项链|包|腰带|围巾|配饰/i.test(normalized)) return 'accessory';

  return 'clothing item';
}
