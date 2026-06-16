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
  };
}

export function parseWardrobeSearchSlot(slot?: string): WardrobeSearchSlot | undefined {
  if (!slot?.trim()) return undefined;
  return SLOT_ALIASES[slot.trim().toLowerCase()];
}

export function resolveMainCategoryForSlot(slot?: string): ClothingMainCategory | undefined {
  const parsed = parseWardrobeSearchSlot(slot);
  return parsed ? SLOT_TO_MAIN_CATEGORY[parsed] : undefined;
}
