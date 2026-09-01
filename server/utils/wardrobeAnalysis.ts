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
}

export const WARDROBE_ANALYSIS_PROMPT = `You are an expert fashion assistant responsible for analyzing clothing items. Your task is to analyze the user-provided image and return a structured JSON object with the item's details.

**JSON Output Format:**
You MUST respond with a single, minified JSON object and nothing else. Do not include markdown backticks (\`\`\`json), explanations, or any text outside of the JSON object.

The JSON object must have the following structure:
{
  "mainCategory": "string",
  "subCategory": "string",
  "season": ["string"],
  "material": ["string"],
  "colors": ["string"],
  "tags": ["string"],
  "description": "string",
  "occasions": ["string"],
  "formality": "string",
  "silhouette": ["string"],
  "searchDescription": "string"
}

## Part 1 — Item classification (unchanged rules; do not let Part 2 override these)

1.  **mainCategory**: The primary category of the item. It MUST be one of the following exact string values: "TOP", "BOTTOM", "OUTERWEAR", "FOOTWEAR", "ACCESSORY", "ONE_PIECE".

2.  **subCategory**: A specific, descriptive sub-category in English (e.g., "T-shirt", "Skinny Jeans", "Trench Coat", "Ankle Boots").

3.  **season**: An array of applicable seasons in English. It MUST contain one or more of the following: "Spring", "Summer", "Autumn", "Winter".

4.  **material**: An array of 1-2 primary materials in English (e.g., ["cotton"], ["polyester", "spandex"]).

5.  **colors**: An array of 1-3 dominant colors present in the item, in English (e.g., ["black", "white", "gray"]).

6.  **tags**: An array of 3-5 descriptive tags in English. Include both style and function (e.g., ["minimal", "layering", "casual"]).

7.  **description**: A concise, one-sentence visual description in English (e.g., "A white short-sleeve cotton t-shirt with a crew neck.").

## Part 2 — Retrieval indexing (derive from Part 1; never change mainCategory or subCategory)

8.  **occasions**: 2-4 lowercase English occasion tokens where this item fits (e.g., ["office", "commute", "casual", "date"]). Use concrete occasion words, not vague aesthetics.

9.  **formality**: Exactly one of: "casual", "smart-casual", "business", "formal".

10. **silhouette**: 1-3 lowercase English fit/silhouette keywords (e.g., ["oversized", "straight-leg", "midi"]).

11. **searchDescription**: 2-3 English sentences for wardrobe search retrieval. Must include occasion + styling context + searchable keywords (office, commute, layer, professional, athletic, etc.). Do NOT only repeat colors or visual details from description.

**Example Input Image:** A picture of a blue denim jacket.
**Example Correct Output:**
{"mainCategory":"OUTERWEAR","subCategory":"Denim Jacket","season":["Spring","Autumn"],"material":["denim"],"colors":["blue"],"tags":["casual","streetwear","layering"],"description":"A classic blue denim jacket with metal buttons.","occasions":["casual","commute","weekend"],"formality":"casual","silhouette":["boxy","cropped"],"searchDescription":"Casual lightweight jacket for spring and autumn commute or weekend outings. Layer over t-shirts and hoodies for everyday street style."}

Now, analyze the following image and provide the JSON object.`;

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

function normalizeFormality(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return WARDROBE_FORMALITY_LEVELS.includes(normalized as WardrobeFormality) ? normalized : null;
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
  const season = normalizeStringArray(raw.season);
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
  };
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
