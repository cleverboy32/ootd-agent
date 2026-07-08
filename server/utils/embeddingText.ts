import type { GatekeeperIntent } from '@/server/agents/intent';
import type { WardrobeSearchSlot } from '@/server/utils/ragSearchSlots';

/** 与入库时 `textForEmbedding` 字段顺序保持一致，便于 query/document 向量对齐 */
export interface WardrobeDocumentEmbeddingFields {
  subCategory: string;
  description: string;
  colors?: string[];
  tags?: string[];
  season?: string[];
  material?: string[];
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

/** 衣橱单品入库时的 embedding 文本（与 app/api/wardrobe/route.ts 原格式一致） */
export function buildWardrobeDocumentEmbeddingText(
  fields: WardrobeDocumentEmbeddingFields
): string {
  const { subCategory, description, colors = [], tags = [], season = [], material = [] } = fields;
  return [
    `Category: ${subCategory}.`,
    `Description: ${description}.`,
    `Colors: ${joinField(colors)}.`,
    `Tags: ${joinField(tags)}.`,
    `Season: ${joinField(season)}.`,
    `Material: ${joinField(material)}.`,
  ].join(' ');
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

function resolveCategoryHint(query: string, slot?: WardrobeSearchSlot): string {
  if (slot) return SLOT_CATEGORY_HINT[slot];

  const normalized = query.trim().toLowerCase();
  if (/dress|gown|skirt/i.test(normalized)) return 'dress';
  if (/pant|trouser|jean|short|bottom/i.test(normalized)) return 'bottom';
  if (/shoe|sneaker|boot|heel|footwear|sandal|loafer|slipper/i.test(normalized)) return 'footwear';
  if (/jacket|coat|outerwear|blazer/i.test(normalized)) return 'outerwear';
  if (/earring|necklace|bag|belt|scarf|accessory/i.test(normalized)) return 'accessory';
  if (/shirt|blouse|top|tee|sweater|cardigan/i.test(normalized)) return 'top';

  return 'clothing item';
}

/**
 * 将检索 query 格式化为与 document embedding 相同的字段结构。
 * 目标：提升 RETRIEVAL_QUERY 与 RETRIEVAL_DOCUMENT（图文）向量的可比性。
 */
export function buildWardrobeQueryEmbeddingText(
  query: string,
  context: WardrobeQueryEmbeddingContext = {}
): string {
  const normalizedQuery = query.trim();
  const category = resolveCategoryHint(normalizedQuery, context.slot);
  const season = inferSeasonFromIntent(context.intent);
  const tags = inferTagsFromIntent(context.intent);

  return buildWardrobeDocumentEmbeddingText({
    subCategory: category,
    description: normalizedQuery,
    colors: [],
    tags,
    season,
    material: [],
  });
}
