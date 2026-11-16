/**
 * Eval helpers: format mock wardrobe items into the same XML shape RAG uses.
 */

export type EvalWardrobeItem = {
  id: string;
  imageUrl?: string;
  mainCategory: string;
  subCategory: string;
  description?: string | null;
  colors?: string[];
  season?: string[];
  tags?: string[];
  material?: string[];
  occasions?: string[];
  formality?: string | null;
  silhouette?: string[];
  tempMin?: number | null;
  tempMax?: number | null;
  similarity?: number;
};

function escapeXmlAttr(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

export function formatEvalWardrobeToXml(items: EvalWardrobeItem[]): {
  xml: string;
  indexMap: Map<string, string>;
} {
  const indexMap = new Map<string, string>();
  if (!items.length) return { xml: '', indexMap };

  const itemsXml = items
    .map((item, i) => {
      const ref = `item_${i}`;
      indexMap.set(ref, item.id);
      const season = (item.season ?? []).join(', ');
      const tags = (item.tags ?? []).join(', ');
      const colors = (item.colors ?? []).join(', ');
      const material = (item.material ?? []).join(', ');
      const occasions = (item.occasions ?? []).join(', ');
      const silhouette = (item.silhouette ?? []).join(', ');
      const formality = item.formality ?? '';
      const tempMin =
        item.tempMin === null || item.tempMin === undefined ? '' : String(item.tempMin);
      const tempMax =
        item.tempMax === null || item.tempMax === undefined ? '' : String(item.tempMax);
      const similarity =
        typeof item.similarity === 'number' ? item.similarity.toFixed(2) : '0.90';
      return `  <item ref="${ref}" name="${escapeXmlAttr(item.subCategory)}" subCategory="${escapeXmlAttr(item.subCategory)}" mainCategory="${escapeXmlAttr(item.mainCategory)}" similarity="${similarity}" description="${escapeXmlAttr(item.description || '')}" colors="${escapeXmlAttr(colors)}" season="${escapeXmlAttr(season)}" tags="${escapeXmlAttr(tags)}" material="${escapeXmlAttr(material)}" occasions="${escapeXmlAttr(occasions)}" formality="${escapeXmlAttr(formality)}" silhouette="${escapeXmlAttr(silhouette)}" tempMin="${escapeXmlAttr(tempMin)}" tempMax="${escapeXmlAttr(tempMax)}"/>`;
    })
    .join('\n');

  return {
    xml: `\n<relevant_wardrobe_items>\n${itemsXml}\n</relevant_wardrobe_items>\n`,
    indexMap,
  };
}
