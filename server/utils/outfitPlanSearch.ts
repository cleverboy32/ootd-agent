import {
  parseWardrobeSearchSlot,
  type WardrobeSearchQuery,
  type WardrobeSearchSlot,
} from '@/server/utils/ragSearchSlots';

export interface OutfitPlanSlot {
  slot: WardrobeSearchSlot;
  target: string;
  search_query: string;
  allow_new: boolean;
}

export interface OutfitPlan {
  id: string;
  overall_concept: string;
  slots: OutfitPlanSlot[];
}

export interface OutfitPlanResult {
  outfits: OutfitPlan[];
}

/** LLM plan JSON → 扁平检索列表（每套每槽一条） */
export function flattenOutfitPlanToQueries(plan: OutfitPlanResult): WardrobeSearchQuery[] {
  const out: WardrobeSearchQuery[] = [];
  for (const outfit of plan.outfits ?? []) {
    const outfitId = (outfit.id || '').trim();
    if (!outfitId) continue;
    for (const slotItem of outfit.slots ?? []) {
      const slot = parseWardrobeSearchSlot(slotItem.slot);
      const query = (slotItem.search_query || '').trim();
      if (!query) continue;
      out.push({
        outfitId,
        slot,
        query,
        target: (slotItem.target || '').trim() || undefined,
        allowNew: slotItem.allow_new !== false,
      });
    }
  }
  return out;
}

/**
 * 粗判 new 名称/描述是否相对 plan query 换了下装主品类（裤↔裙）。
 * 仅供 audit / 单测，不阻塞主链路。
 */
export function planQueryBottomCategoryConflict(
  planQuery: string,
  newItemText: string
): boolean {
  const q = planQuery;
  const t = newItemText;
  const queryPants = /裤|西裤|牛仔裤|阔腿|直筒裤|九分裤/.test(q) && !/裙/.test(q);
  const querySkirt = /裙|半裙|A字|百褶/.test(q) && !/裤/.test(q);
  const textPants = /裤|西裤|牛仔裤|阔腿|直筒裤|九分裤/.test(t) && !/裙/.test(t);
  const textSkirt = /裙|半裙|A字|百褶/.test(t);
  if (queryPants && textSkirt) return true;
  if (querySkirt && textPants) return true;
  return false;
}
