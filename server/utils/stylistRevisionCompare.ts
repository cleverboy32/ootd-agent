import type { StylistOutfit } from '@/server/agents/stylist';

/** 微调是否换品：衣橱比 id；new_item 还要比 name/description，避免只改名仍判「未变」。 */
export function outfitItemFingerprints(outfit: StylistOutfit): string[] {
  return outfit.selected_items
    .map((item) => {
      const layer = (item.layer || '').trim().toLowerCase();
      if (item.id === 'new_item') {
        const name = (item.name || '').trim().toLowerCase();
        const desc = (item.description || '').trim().slice(0, 64).toLowerCase();
        return `${layer}|new_item|${name}|${desc}`;
      }
      return `${layer}|${item.id}`;
    })
    .sort();
}

export function outfitsHaveSameItemFingerprints(
  prev: StylistOutfit,
  next: StylistOutfit
): boolean {
  const a = outfitItemFingerprints(prev);
  const b = outfitItemFingerprints(next);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
