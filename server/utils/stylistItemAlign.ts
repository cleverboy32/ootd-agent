import type { ClothingItem } from '@prisma/client';
import type { StylistResult } from '@/server/agents/stylist/schema';

type AccessoryFamily = 'earring' | 'necklace' | 'other';

function replaceIgnoringCase(haystack: string, from: string, to: string): string {
  if (!from.trim() || from.toLowerCase() === to.toLowerCase()) return haystack;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return haystack.replace(new RegExp(escaped, 'gi'), to);
}

function accessoryFamily(text: string): AccessoryFamily {
  const t = text.toLowerCase();
  if (/\bearrings?\b|\bear\s*drop\b|\bdangle\b|耳坠|耳环|耳钉/.test(t)) return 'earring';
  if (/\bnecklace\b|\bpendant\b|\bchoker\b|项链|颈链|吊坠/.test(t)) return 'necklace';
  return 'other';
}

function groundedAccessoryPhrase(item: Pick<ClothingItem, 'subCategory' | 'description'>): string {
  const desc = item.description?.trim();
  if (desc) {
    const clipped = desc.replace(/\.$/, '');
    return clipped.charAt(0).toLowerCase() + clipped.slice(1);
  }
  return item.subCategory;
}

/**
 * 当 outfit_details 的配饰品类与衣橱 subCategory 冲突时，用真实描述改写结尾配饰句。
 */
export function reconcileAccessoryOutfitDetails(
  outfitDetails: string,
  item: Pick<ClothingItem, 'subCategory' | 'description'>
): string {
  const target = accessoryFamily(item.subCategory);
  if (target === 'other') return outfitDetails;

  const textFamily = accessoryFamily(outfitDetails);
  if (textFamily === 'other' || textFamily === target) return outfitDetails;

  const phrase = groundedAccessoryPhrase(item);
  const finishedWith = /,\s*finished with\b.+$/i;
  if (finishedWith.test(outfitDetails)) {
    return outfitDetails.replace(finishedWith, `, finished with ${phrase}.`);
  }
  return `${outfitDetails.replace(/\.\s*$/, '')}, finished with ${phrase}.`;
}

/** 修正 overall_concept 里与真实配饰品类冲突的中英用词 */
export function reconcileAccessoryConcept(
  concept: string,
  item: Pick<ClothingItem, 'subCategory'>
): string {
  const target = accessoryFamily(item.subCategory);
  if (target === 'other') return concept;

  const textFamily = accessoryFamily(concept);
  if (textFamily === 'other' || textFamily === target) return concept;

  if (target === 'earring') {
    return concept
      .replace(/银色几何项链/g, item.subCategory)
      .replace(/几何项链/g, item.subCategory)
      .replace(/项链/g, '耳环')
      .replace(/\bpendant necklace\b/gi, item.subCategory)
      .replace(/\bnecklace\b/gi, 'earrings')
      .replace(/\bchoker\b/gi, 'earrings');
  }
  if (target === 'necklace') {
    return concept
      .replace(/耳环|耳坠|耳钉/g, '项链')
      .replace(/\bearrings?\b/gi, 'necklace');
  }
  return concept;
}

/**
 * 用衣橱元数据强制对齐 Stylist 输出的 name，并修正明显品类冲突的文案。
 */
export function alignStylistItemsWithWardrobe(
  result: StylistResult,
  ragCache: Map<string, Pick<ClothingItem, 'subCategory' | 'description' | 'mainCategory'>>
): void {
  for (const outfit of result.outfits) {
    for (const item of outfit.selected_items) {
      if (!item.id || item.id === 'new_item') continue;
      const cached = ragCache.get(item.id);
      if (!cached?.subCategory?.trim()) continue;

      const oldName = item.name?.trim() ?? '';
      const newName = cached.subCategory.trim();
      const nameChanged = Boolean(oldName) && oldName.toLowerCase() !== newName.toLowerCase();

      item.name = newName;

      if (nameChanged) {
        outfit.overall_concept = replaceIgnoringCase(outfit.overall_concept, oldName, newName);
        outfit.visual_composition.outfit_details = replaceIgnoringCase(
          outfit.visual_composition.outfit_details,
          oldName,
          newName
        );
      }

      const isAccessory =
        item.layer === 'accessory' || cached.mainCategory === 'ACCESSORY';
      if (isAccessory) {
        outfit.visual_composition.outfit_details = reconcileAccessoryOutfitDetails(
          outfit.visual_composition.outfit_details,
          cached
        );
        outfit.overall_concept = reconcileAccessoryConcept(outfit.overall_concept, cached);
      }
    }
  }
}
