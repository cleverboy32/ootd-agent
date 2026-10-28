import type { StylistOutfit, StylistResult } from './schema';

type OutfitLike = Pick<StylistOutfit, 'selected_items'>;

/** 从近期方案里抽出 new_item 的 layer+name，供重做时避复用。 */
export function collectRecentNewItemLabels(
  previousOutfits?: OutfitLike[] | null,
  priorResults?: Array<Pick<StylistResult, 'outfits'>> | null
): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();

  const pushFrom = (outfits: OutfitLike[] | undefined) => {
    for (const outfit of outfits ?? []) {
      for (const item of outfit.selected_items ?? []) {
        if (item.id !== 'new_item') continue;
        const name = item.name?.trim() ?? '';
        const layer = item.layer?.trim() ?? '';
        if (!name) continue;
        const label = layer ? `${layer}: ${name}` : name;
        const key = label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        labels.push(label);
      }
    }
  };

  pushFrom(previousOutfits ?? undefined);
  for (const result of (priorResults ?? []).slice(-3)) {
    pushFrom(result.outfits);
  }
  return labels;
}

/**
 * outfit_redo / 再次出整套时：禁止 new_item 复读上一套同色同品类。
 */
export function buildNewItemDiversityBlock(
  requestType: string,
  recentNewItemLabels: string[]
): string {
  if (recentNewItemLabels.length === 0) return '';
  if (requestType !== 'outfit_redo' && requestType !== 'wardrobe_outfit') return '';

  return `
【新品多样性 — 必须遵守】
- 上一轮/近期方案已推荐过这些 new_item：${recentNewItemLabels.join('；')}
- 本轮若仍用 new_item 补位，【禁止】复用相同颜色 + 相同品类轮廓（例如又出藏青短风衣）。须换颜色或换品类（如米灰短外套、深棕薄开衫、浅驼风衣、牛仔外套等）。
- 衣橱 XML 已有可接受的薄外套或压色候选时，优先用衣橱，不要为了「更完美」再造同一件。
`;
}
