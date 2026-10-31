import { ClothingMainCategory } from '@prisma/client';

/** Stylist 规划的衣橱检索槽位 */
export type WardrobeSearchSlot =
  | 'top'
  | 'bottom'
  | 'dress'
  | 'shoes'
  | 'outerwear'
  | 'accessory';

export interface WardrobeSearchQuery {
  query: string;
  slot?: WardrobeSearchSlot;
  /** Plan→Retrieve：归属哪一套方案；缺省表示全局槽（旧路径） */
  outfitId?: string;
  /** Plan 槽位目标描述（供 Reconcile / audit） */
  target?: string;
  allowNew?: boolean;
}

export type WardrobeSearchInput = string | WardrobeSearchQuery;

const SLOT_ALIASES: Record<string, WardrobeSearchSlot> = {
  top: 'top',
  inner_top: 'top',
  bottom: 'bottom',
  dress: 'dress',
  one_piece: 'dress',
  shoes: 'shoes',
  outerwear: 'outerwear',
  accessory: 'accessory',
};

const SLOT_TO_MAIN_CATEGORY: Record<WardrobeSearchSlot, ClothingMainCategory> = {
  top: ClothingMainCategory.TOP,
  bottom: ClothingMainCategory.BOTTOM,
  dress: ClothingMainCategory.ONE_PIECE,
  shoes: ClothingMainCategory.FOOTWEAR,
  outerwear: ClothingMainCategory.OUTERWEAR,
  accessory: ClothingMainCategory.ACCESSORY,
};

export function normalizeWardrobeSearchInput(input: WardrobeSearchInput): WardrobeSearchQuery {
  if (typeof input === 'string') {
    return { query: input.trim() };
  }
  return {
    query: input.query.trim(),
    slot: input.slot,
    outfitId: input.outfitId?.trim() || undefined,
    target: input.target?.trim() || undefined,
    allowNew: input.allowNew,
  };
}

/** 相同 slot+query 合并为一次向量检索；outfitIds 记录共享方 */
export function collapseIdenticalSlotQueries(
  queries: WardrobeSearchQuery[]
): Array<WardrobeSearchQuery & { outfitIds: string[] }> {
  const groups = new Map<string, WardrobeSearchQuery & { outfitIds: string[] }>();
  for (const item of queries) {
    const q = item.query.trim();
    if (!q) continue;
    const slot = item.slot ?? '';
    const key = `${slot}||${q}`;
    const outfitId = item.outfitId?.trim() || '';
    const existing = groups.get(key);
    if (existing) {
      if (outfitId && !existing.outfitIds.includes(outfitId)) {
        existing.outfitIds.push(outfitId);
      }
      continue;
    }
    groups.set(key, {
      query: q,
      slot: item.slot,
      target: item.target,
      allowNew: item.allowNew,
      outfitIds: outfitId ? [outfitId] : [],
    });
  }
  return [...groups.values()];
}

export function parseWardrobeSearchSlot(slot?: string): WardrobeSearchSlot | undefined {
  if (!slot?.trim()) return undefined;
  return SLOT_ALIASES[slot.trim().toLowerCase()];
}

export function resolveMainCategoryForSlot(slot?: string): ClothingMainCategory | undefined {
  const parsed = parseWardrobeSearchSlot(slot);
  return parsed ? SLOT_TO_MAIN_CATEGORY[parsed] : undefined;
}
