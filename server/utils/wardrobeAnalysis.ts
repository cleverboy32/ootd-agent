import type { ClothingMainCategory } from '@prisma/client';
import { Type, type Schema } from '@google/genai';

export const WARDROBE_FORMALITY_LEVELS = [
  'casual',
  'smart-casual',
  'business',
  'formal',
] as const;

export type WardrobeFormality = (typeof WARDROBE_FORMALITY_LEVELS)[number];

/** LLM 分析输出；Part 1 分类字段与旧版一致，Part 2 为检索导向扩展 */
export interface WardrobeAnalysisResult {
  mainCategory: ClothingMainCategory;
  subCategory: string;
  season: string[];
  material: string[];
  colors: string[];
  tags: string[];
  description: string;
  occasions?: string[];
  formality?: string;
  silhouette?: string[];
  searchDescription?: string;
  /** 合适穿着温度下限（摄氏度）。空表示不设下限 */
  tempMin?: number | null;
  /** 合适穿着温度上限（摄氏度）。空表示不设上限 */
  tempMax?: number | null;
}

export interface NormalizedWardrobeAnalysis {
  mainCategory: ClothingMainCategory;
  subCategory: string;
  season: string[];
  material: string[];
  colors: string[];
  tags: string[];
  description: string;
  occasions: string[];
  formality: string | null;
  silhouette: string[];
  searchDescription: string;
  tempMin: number | null;
  tempMax: number | null;
}

export const WARDROBE_ANALYSIS_PROMPT = `你是服装识别助手。根据用户给出的衣服图片，只返回一个压缩 JSON，不要 markdown，不要解释。

自由文本全部用中文：subCategory、description、material、colors、tags、silhouette、occasions、searchDescription。
mainCategory 必须是 TOP、BOTTOM、OUTERWEAR、FOOTWEAR、ACCESSORY、ONE_PIECE 之一。
season 用「春、夏、秋、冬」。formality 用「休闲、商务休闲、商务、正式」之一。

1. subCategory：中文品类名，如「圆领短袖」「直筒牛仔裤」「棒球夹克」。
2. season：可穿季节，取自春、夏、秋、冬。
3. material：1-2 个衣身面料。起毛、罗纹或针织不要写成棉。里布是牛仔时，材质仍写衣身的尼龙或聚酯，不要把整件标成牛仔。
4. colors：1-3 个穿着时从外面能看到的大面积颜色。领口内侧、翻起来才露出的袖口、里布、线迹、小标，以及和衣身同色的细松紧，不要记成第二种颜色。
5. tags：3-5 个中文标签，包含风格和用途。内里不要写成镶边、拼接或撞色。
6. description：一句外观。写能看见的面料和纹理。有罗纹或起毛的有领衣服要写针织或毛呢，不要写成光滑衬衫。衣身蓬起的外套要写棉服，不要写成轻薄夹克。内里不要写成镶边或拼接。
7. occasions：2-4 个中文场合，如通勤、休闲、约会。
8. formality：休闲、商务休闲、商务、正式 之一。
9. silhouette：1-3 个中文廓形，如宽松、直筒、短款。
10. searchDescription：2-3 句中文，写场合和怎么搭，供检索。不要只重复外观，也不要把内里颜色写成可检索词。
11. tempMin、tempMax：这件衣服作为合适穿着的摄氏度，含边界。不是勉强能穿的范围。某一侧不封时用 null。配饰两个都用 null。温度按填充和厚度判断，款式名不决定温度。棒球领、牛仔外套、西装外套不能直接套成薄外套。
    棉服看蓬松，不看有没有绗缝线。袖子圆、衣身鼓起、挂着不塌、下摆收口上面仍是厚的一圈，就是有填充，品类写成棉服。尼龙上的软皱是罩在填充外面的，不要写成轻薄、轻量或薄壳。棉服大约 8-17。
    看得到绗缝或充绒的羽绒服和厚派克，tempMax 至多 12，不要标成 5-20。
    只有衣身贴着、能看出是一层布的夹克、开衫、衬衫外套才用 13-25。
    薄针织和毛呢衬衫大约 12-22。毛衣更暖，tempMax 大约 15。
    短袖 tempMin 至少 22，没有上限时 tempMax 为 null。

{"mainCategory":"OUTERWEAR","subCategory":"牛仔外套","season":["春","秋"],"material":["牛仔"],"colors":["蓝"],"tags":["休闲","通勤","叠穿"],"description":"蓝色牛仔外套，金属扣，衣身是牛仔面料。","occasions":["休闲","通勤"],"formality":"休闲","silhouette":["短款","直筒"],"searchDescription":"休闲薄外套，适合春秋通勤和周末。可叠在上衣外面。","tempMin":13,"tempMax":25}`

export const WARDROBE_ANALYSIS_JSON_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    mainCategory: { type: Type.STRING },
    subCategory: { type: Type.STRING },
    season: { type: Type.ARRAY, items: { type: Type.STRING } },
    material: { type: Type.ARRAY, items: { type: Type.STRING } },
    colors: { type: Type.ARRAY, items: { type: Type.STRING } },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    description: { type: Type.STRING },
    occasions: { type: Type.ARRAY, items: { type: Type.STRING } },
    formality: { type: Type.STRING },
    silhouette: { type: Type.ARRAY, items: { type: Type.STRING } },
    searchDescription: { type: Type.STRING },
    tempMin: { type: Type.INTEGER, nullable: true },
    tempMax: { type: Type.INTEGER, nullable: true },
  },
  required: ['mainCategory', 'subCategory', 'season', 'material', 'colors', 'tags', 'description'],
};

const MAIN_CATEGORY_ALIASES: Record<string, ClothingMainCategory> = {
  TOP: 'TOP',
  TOPS: 'TOP',
  SHIRT: 'TOP',
  SHIRTS: 'TOP',
  BOTTOM: 'BOTTOM',
  BOTTOMS: 'BOTTOM',
  PANTS: 'BOTTOM',
  TROUSERS: 'BOTTOM',
  JEANS: 'BOTTOM',
  OUTERWEAR: 'OUTERWEAR',
  JACKET: 'OUTERWEAR',
  COAT: 'OUTERWEAR',
  BLAZER: 'OUTERWEAR',
  FOOTWEAR: 'FOOTWEAR',
  SHOES: 'FOOTWEAR',
  SHOE: 'FOOTWEAR',
  SNEAKERS: 'FOOTWEAR',
  BOOTS: 'FOOTWEAR',
  ACCESSORY: 'ACCESSORY',
  ACCESSORIES: 'ACCESSORY',
  JEWELRY: 'ACCESSORY',
  ONE_PIECE: 'ONE_PIECE',
  ONEPIECE: 'ONE_PIECE',
  DRESS: 'ONE_PIECE',
  DRESSES: 'ONE_PIECE',
};

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[,;/|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function normalizeMainCategory(value: unknown): ClothingMainCategory | null {
  if (typeof value !== 'string') return null;
  const token = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (Object.values(MAIN_CATEGORY_ALIASES).includes(token as ClothingMainCategory)) {
    return token as ClothingMainCategory;
  }
  return MAIN_CATEGORY_ALIASES[token] ?? null;
}

function normalizeStringArray(values: unknown, lowercase = true): string[] {
  return coerceStringArray(values).map((value) => (lowercase ? value.toLowerCase() : value));
}

const SEASON_ALIASES: Record<string, string> = {
  spring: 'spring',
  summer: 'summer',
  autumn: 'autumn',
  fall: 'autumn',
  winter: 'winter',
  春: 'spring',
  春季: 'spring',
  夏: 'summer',
  夏季: 'summer',
  秋: 'autumn',
  秋季: 'autumn',
  冬: 'winter',
  冬季: 'winter',
};

const FORMALITY_ALIASES: Record<string, WardrobeFormality> = {
  casual: 'casual',
  休闲: 'casual',
  'smart-casual': 'smart-casual',
  smartcasual: 'smart-casual',
  商务休闲: 'smart-casual',
  business: 'business',
  商务: 'business',
  formal: 'formal',
  正式: 'formal',
};

export function normalizeSeasonList(value: unknown): string[] {
  const seen = new Set<string>();
  for (const token of coerceStringArray(value)) {
    const mapped = SEASON_ALIASES[token.trim().toLowerCase()] ?? SEASON_ALIASES[token.trim()];
    if (mapped) seen.add(mapped);
  }
  return [...seen];
}

function normalizeFormality(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = value.trim().toLowerCase();
  return FORMALITY_ALIASES[token] ?? FORMALITY_ALIASES[value.trim()] ?? null;
}

function buildSearchDescriptionFallback(analysis: WardrobeAnalysisResult): string {
  const parts = [
    analysis.subCategory,
    analysis.description,
    analysis.tags?.length ? `Tags: ${analysis.tags.join(', ')}` : '',
    analysis.occasions?.length ? `Occasions: ${analysis.occasions.join(', ')}` : '',
  ].filter(Boolean);
  return parts.join('. ');
}

/** 硬校验 Part 1 分类字段；Part 2 缺失时用 fallback，不阻断入库 */
export function normalizeWardrobeAnalysis(
  raw: WardrobeAnalysisResult | Record<string, unknown>
): NormalizedWardrobeAnalysis | null {
  const mainCategory = normalizeMainCategory(raw.mainCategory);
  const subCategory = typeof raw.subCategory === 'string' ? raw.subCategory.trim() : '';
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  const season = normalizeSeasonList(raw.season);
  const material = normalizeStringArray(raw.material);
  const colors = normalizeStringArray(raw.colors);
  const tags = normalizeStringArray(raw.tags);

  if (!mainCategory || !subCategory || !description) {
    return null;
  }

  const analysis: WardrobeAnalysisResult = {
    mainCategory,
    subCategory,
    season,
    material,
    colors,
    tags,
    description,
    occasions: normalizeStringArray(raw.occasions),
    formality: typeof raw.formality === 'string' ? raw.formality : undefined,
    silhouette: normalizeStringArray(raw.silhouette),
    searchDescription:
      typeof raw.searchDescription === 'string' ? raw.searchDescription : undefined,
  };
  const { tempMin, tempMax } = normalizeTempRange(raw.tempMin, raw.tempMax);

  const searchDescription =
    analysis.searchDescription?.trim() || buildSearchDescriptionFallback(analysis);

  return {
    mainCategory,
    subCategory,
    season,
    material,
    colors,
    tags,
    description,
    occasions: analysis.occasions ?? [],
    formality: normalizeFormality(analysis.formality),
    silhouette: analysis.silhouette ?? [],
    searchDescription,
    tempMin,
    tempMax,
  };
}

/** 合适穿着温度。非法值丢弃；上下限颠倒时对调。 */
export function normalizeTempBound(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < -40 || rounded > 50) return null;
  return rounded;
}

export function normalizeTempRange(
  min: unknown,
  max: unknown
): { tempMin: number | null; tempMax: number | null } {
  let tempMin = normalizeTempBound(min);
  let tempMax = normalizeTempBound(max);
  if (tempMin !== null && tempMax !== null && tempMin > tempMax) {
    [tempMin, tempMax] = [tempMax, tempMin];
  }
  return { tempMin, tempMax };
}

export function wardrobeAnalysisToEmbeddingFields(
  analysis: NormalizedWardrobeAnalysis
) {
  return {
    mainCategory: analysis.mainCategory,
    subCategory: analysis.subCategory,
    description: analysis.description,
    searchDescription: analysis.searchDescription,
    colors: analysis.colors,
    tags: analysis.tags,
    season: analysis.season,
    material: analysis.material,
    occasions: analysis.occasions,
    formality: analysis.formality ?? undefined,
    silhouette: analysis.silhouette,
  };
}

export function clothingItemToEmbeddingFields(item: {
  mainCategory: ClothingMainCategory;
  subCategory: string;
  description: string | null;
  searchDescription?: string | null;
  colors: string[];
  tags: string[];
  season: string[];
  material: string[];
  occasions?: string[];
  formality?: string | null;
  silhouette?: string[];
}) {
  return wardrobeAnalysisToEmbeddingFields({
    mainCategory: item.mainCategory,
    subCategory: item.subCategory,
    description: item.description ?? '',
    searchDescription:
      item.searchDescription?.trim() ||
      buildSearchDescriptionFallback({
        mainCategory: 'TOP',
        subCategory: item.subCategory,
        season: item.season,
        material: item.material,
        colors: item.colors,
        tags: item.tags,
        description: item.description ?? '',
      }),
    colors: item.colors,
    tags: item.tags,
    season: item.season,
    material: item.material,
    occasions: item.occasions ?? [],
    formality: item.formality ?? null,
    silhouette: item.silhouette ?? [],
    tempMin: null,
    tempMax: null,
  });
}

/** Visual 向量用简化文本（不含 searchDescription 全套） */
export function buildVisualEmbeddingDocumentText(item: {
  subCategory: string;
  description: string | null;
  colors: string[];
}): string {
  const colors = item.colors.join(', ');
  return [item.subCategory, item.description ?? '', colors ? `Colors: ${colors}` : '']
    .filter(Boolean)
    .join('. ');
}
