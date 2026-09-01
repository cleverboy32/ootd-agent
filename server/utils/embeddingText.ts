import type { GatekeeperIntent } from '@/server/agents/intent';
import type { WardrobeSearchSlot } from '@/server/utils/ragSearchSlots';
import { resolveMainCategoryForSlot } from '@/server/utils/ragSearchSlots';
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
  bottom: 'bottom',
  dress: 'dress',
  shoes: 'footwear',
  outerwear: 'outerwear',
  accessory: 'accessory',
};

function joinField(values?: string[]): string {
  return values?.filter(Boolean).join(', ') ?? '';
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

  const retrievalDescription = searchDescription?.trim() || description;
  const { omitEmptyFields = false } = options;
  const mainCategoryLabel = mainCategory?.toString().trim();

  const segments: Array<string | null> = [
    mainCategoryLabel ? `MainCategory: ${mainCategoryLabel}.` : null,
    `Category: ${subCategory}.`,
    retrievalDescription ? `Description: ${retrievalDescription}.` : null,
    description.trim() ? `Visual: ${description}.` : omitEmptyFields ? null : `Visual: ${description}.`,
    colors.length || !omitEmptyFields ? `Colors: ${joinField(colors)}.` : null,
    tags.length || !omitEmptyFields ? `Tags: ${joinField(tags)}.` : null,
    occasions.length || !omitEmptyFields ? `Occasions: ${joinField(occasions)}.` : null,
    formality?.trim() || !omitEmptyFields ? `Formality: ${formality?.trim() || ''}.` : null,
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
    dress: 'dress',
    footwear: 'shoes',
    outerwear: 'outerwear',
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
 * Stylist 检索 query：与 document 同结构；仅在 query 中注入可识别颜色，其余保持原逻辑。
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

  return buildWardrobeDocumentEmbeddingText({
    mainCategory,
    subCategory: category,
    description: '',
    searchDescription: normalizedQuery,
    colors,
    tags,
    occasions,
    season,
    material: [],
  });
}

function resolveCategoryHint(query: string, slot?: WardrobeSearchSlot): string {
  if (slot) return SLOT_CATEGORY_HINT[slot];

  const normalized = query.trim().toLowerCase();
  if (/dress|gown|skirt/i.test(normalized)) return 'dress';
  if (/shirt|blouse|top|tee|sweater|cardigan|short sleeve/i.test(normalized)) return 'top';
  if (/pant|trouser|jean|\bshorts\b|bottom/i.test(normalized)) return 'bottom';
  if (/shoe|sneaker|boot|heel|footwear|sandal|loafer|slipper/i.test(normalized)) return 'footwear';
  if (/jacket|coat|outerwear|blazer/i.test(normalized)) return 'outerwear';
  if (/earring|necklace|bag|belt|scarf|accessory/i.test(normalized)) return 'accessory';

  return 'clothing item';
}
