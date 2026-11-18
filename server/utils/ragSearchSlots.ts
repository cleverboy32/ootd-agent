import { ClothingMainCategory } from '@prisma/client';

/** Stylist 规划的衣橱检索槽位 */
export type WardrobeSearchSlot =
  | 'top'
  | 'inner_top'
  | 'bottom'
  | 'inner_bottom'
  | 'skirt'
  | 'shoes'
  | 'outerwear'
  | 'legwear'
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
  /** 内搭：与 top 同为大类 TOP，但是独立检索槽（温区可不同） */
  inner_top: 'inner_top',
  bottom: 'bottom',
  /** 裤内贴身层：与 bottom 同为大类 BOTTOM，独立检索槽（温区可不同） */
  inner_bottom: 'inner_bottom',
  /** 所有裙装（半身裙+连衣裙）；历史 dress/one_piece 别名 */
  skirt: 'skirt',
  dress: 'skirt',
  one_piece: 'skirt',
  shoes: 'shoes',
  outerwear: 'outerwear',
  legwear: 'legwear',
  accessory: 'accessory',
};

const SLOT_TO_MAIN_CATEGORY: Record<WardrobeSearchSlot, ClothingMainCategory> = {
  top: ClothingMainCategory.TOP,
  inner_top: ClothingMainCategory.TOP,
  bottom: ClothingMainCategory.BOTTOM,
  inner_bottom: ClothingMainCategory.BOTTOM,
  /** 裙装统一 ONE_PIECE（含半身裙迁移后） */
  skirt: ClothingMainCategory.ONE_PIECE,
  shoes: ClothingMainCategory.FOOTWEAR,
  outerwear: ClothingMainCategory.OUTERWEAR,
  /** 打底袜等腿层：独立 SOCKS 大类，与首饰/包等 ACCESSORY 分开检索 */
  legwear: ClothingMainCategory.SOCKS,
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

export type CollapsedSlotQuery = WardrobeSearchQuery & { outfitIds: string[] };

/** 相同 slot+query 合并为一次向量检索；outfitIds 记录共享方 */
export function collapseIdenticalSlotQueries(queries: WardrobeSearchQuery[]): CollapsedSlotQuery[] {
  const groups = new Map<string, CollapsedSlotQuery>();
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

/**
 * 无 style：按 slot 合并（整轮每槽一次）；canonical query 优先 outfit_1。
 * 有 style：等同 collapseIdenticalSlotQueries（slot||query）。
 */
export function collapseQueriesForRound(
  queries: WardrobeSearchQuery[],
  options: { sharedPoolBySlot: boolean }
): CollapsedSlotQuery[] {
  if (!options.sharedPoolBySlot) {
    return collapseIdenticalSlotQueries(queries);
  }

  type Acc = CollapsedSlotQuery & { preferOutfit1: boolean };
  const bySlot = new Map<string, Acc>();

  for (const item of queries) {
    const q = item.query.trim();
    if (!q) continue;
    const slotKey = item.slot ?? '';
    const outfitId = item.outfitId?.trim() || '';
    const isOutfit1 = outfitId === 'outfit_1';
    const existing = bySlot.get(slotKey);

    if (!existing) {
      bySlot.set(slotKey, {
        query: q,
        slot: item.slot,
        target: item.target,
        allowNew: item.allowNew,
        outfitIds: outfitId ? [outfitId] : [],
        preferOutfit1: isOutfit1,
      });
      continue;
    }

    if (outfitId && !existing.outfitIds.includes(outfitId)) {
      existing.outfitIds.push(outfitId);
    }
    if (isOutfit1 && !existing.preferOutfit1) {
      existing.query = q;
      existing.target = item.target;
      existing.allowNew = item.allowNew;
      existing.preferOutfit1 = true;
    }
  }

  return [...bySlot.values()].map(({ preferOutfit1: _p, ...rest }) => rest);
}

export function parseWardrobeSearchSlot(slot?: string): WardrobeSearchSlot | undefined {
  if (!slot?.trim()) return undefined;
  return SLOT_ALIASES[slot.trim().toLowerCase()];
}

export function resolveMainCategoryForSlot(slot?: string): ClothingMainCategory | undefined {
  const parsed = parseWardrobeSearchSlot(slot);
  return parsed ? SLOT_TO_MAIN_CATEGORY[parsed] : undefined;
}
