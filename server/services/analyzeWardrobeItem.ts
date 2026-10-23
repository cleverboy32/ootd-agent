import prismadb from '@/server/db';
import { llmGenerate } from '@/server/services/llm/client';
import { extractJsonText } from '@/server/services/llm/convert';
import { AGENT_MODELS } from '@/server/config/models';
import { urlToGenerativePart } from '@/server/utils/image';
import { persistTextEmbedding, persistVisualEmbedding } from '@/server/services/wardrobeService';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import {
  normalizeWardrobeAnalysis,
  WARDROBE_ANALYSIS_JSON_SCHEMA,
  WARDROBE_ANALYSIS_PROMPT,
  type NormalizedWardrobeAnalysis,
} from '@/server/utils/wardrobeAnalysis';

export async function analyzeWardrobeImage(imageUrl: string): Promise<NormalizedWardrobeAnalysis> {
  const imagePart = await urlToGenerativePart(imageUrl);
  const result = await withRetryOn429(
    () =>
      llmGenerate({
        model: AGENT_MODELS.wardrobeAnalysis,
        contents: [{ role: 'user', parts: [imagePart, { text: WARDROBE_ANALYSIS_PROMPT }] }],
        jsonSchema: WARDROBE_ANALYSIS_JSON_SCHEMA,
      }),
    { label: 'Wardrobe analysis', maxRetries: 4 }
  );

  const responseText = result.text;
  if (!responseText) {
    throw new Error('AI 分析没有返回内容');
  }

  const analysis = normalizeWardrobeAnalysis(JSON.parse(extractJsonText(responseText)));
  if (!analysis) {
    throw new Error('AI 分析结果异常');
  }
  return analysis;
}

export function wardrobeAnalysisUpdateData(analysis: NormalizedWardrobeAnalysis) {
  return {
    mainCategory: analysis.mainCategory,
    subCategory: analysis.subCategory,
    season: analysis.season,
    material: analysis.material,
    colors: analysis.colors,
    tags: analysis.tags,
    description: analysis.description,
    searchDescription: analysis.searchDescription,
    occasions: analysis.occasions,
    formality: analysis.formality,
    silhouette: analysis.silhouette,
    tempMin: analysis.tempMin,
    tempMax: analysis.tempMax,
  };
}

/** 用原图重分析已有单品，并重建文本向量和图片向量。 */
export async function reanalyzeWardrobeItem(itemId: string) {
  const existing = await prismadb.clothingItem.findUnique({ where: { id: itemId } });
  if (!existing) {
    throw new Error('Item not found');
  }

  const analysis = await analyzeWardrobeImage(existing.imageUrl);
  const item = await prismadb.clothingItem.update({
    where: { id: itemId },
    data: wardrobeAnalysisUpdateData(analysis),
  });
  await persistTextEmbedding(itemId);
  await persistVisualEmbedding(itemId);
  return item;
}
