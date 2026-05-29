import { searchWardrobeItemsByText, WardrobeSearchResult } from '../../../../server/services/wardrobeService';
import { distillUserQueryForSearch } from '../../../../server/services/promptProcessor';
import { ClothingItem } from '@prisma/client';
import { Part } from '@google/genai'; // 确保 Part 类型被导入

/**
 * Formats the search results into an XML string for the AI prompt.
 * @param items The search results from the wardrobe.
 * @returns An XML-formatted string of wardrobe items.
 */
function formatResultsToXml(items: WardrobeSearchResult[]): string {
  if (items.length === 0) {
    return '';
  }

  const itemsXml = items
    .map(
      (item) =>
        // 使用 item.id, item.mainCategory, etc.
        `  <item id="${item.id}" name="${item.subCategory}" description="${item.description || ''}" colors="${item.colors.join(', ')}"/>`
    )
    .join('\n');

  return `\n<relevant_wardrobe_items>\n${itemsXml}\n</relevant_wardrobe_items>\n`;
}

/**
 * Performs a RAG search against the user's wardrobe using query distillation.
 * @param initialParts The user's original input, can contain text and images.
 * @param userId The user's ID.
 * @param ragCache A cache to store search results for the current request.
 * @returns An object containing the XML string for the prompt and the found items.
 */
export async function performRagSearch(
  initialParts: Part[], // <--- 接收的是 Part[] 数组
  userId: string,
  ragCache: Map<string, ClothingItem>
): Promise<{ xmlString: string; items: ClothingItem[] }> {
  console.log('[RAG_HANDLER] Starting RAG search process...');
  
  // [FIX] 从 Part[] 数组中提取文本内容
  const textPart = initialParts.find((part): part is { text: string } => 'text' in part);
  const userMessage = textPart?.text || '';

  if (!userMessage) {
    console.log('[RAG_HANDLER] No text found in initial parts. Skipping RAG search.');
    return { xmlString: '', items: [] };
  }

  // 1. Distill the user's query to get better search keywords.
  const distilledQuery = await distillUserQueryForSearch(userMessage); // <--- 现在传递的是正确的字符串

  if (!distilledQuery) {
    console.log('[RAG_HANDLER] Query distillation resulted in empty string. Skipping search.');
      return { xmlString: '', items: [] };
    }
    
  try {
    // 2. Perform semantic search using the distilled query.
    const searchResults = await searchWardrobeItemsByText(distilledQuery, userId);

    if (searchResults.length === 0) {
      console.log('[RAG_HANDLER] No relevant items found in wardrobe after distillation.');
    return { xmlString: '', items: [] };
  }

    console.log(`[RAG_HANDLER] Found ${searchResults.length} relevant items. Caching and formatting to XML.`);

    // 3. Convert search results to ClothingItem type and populate the cache.
    const clothingItems: ClothingItem[] = searchResults.map(result => ({
      ...result,
      // Fill in non-overlapping fields from ClothingItem model if necessary
      clientProfileId: userId,
      season: [], // These fields are not in WardrobeSearchResult, so provide defaults
      material: [],
      tags: [],
      embedding: null, // We don't need the embedding here
      createdAt: new Date(),
      updatedAt: new Date(),
    })); 

    clothingItems.forEach(item => ragCache.set(item.id, item));
    
    // 4. Format the results into an XML string for the prompt.
    const xmlString = formatResultsToXml(searchResults);

    return {
      xmlString,
      items: clothingItems,
    };
  } catch (error) {
    console.error('[RAG_HANDLER] Error during RAG search:', error);
    return { xmlString: '', items: [] };
}
}

