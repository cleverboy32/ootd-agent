import type { SlotMatchAssessment } from '@/server/utils/ragMatchQuality';
import type { WardrobeSearchSlot } from '@/server/utils/ragSearchSlots';
import type { StylistResult } from '@/server/agents/stylist/schema';

export interface StylistSelectionCandidate {
  id: string;
  subCategory: string;
  similarity: number;
}

export interface StylistSelectionSlotSnapshot {
  slot: string;
  matchStatus?: SlotMatchAssessment['status'];
  bestSimilarity?: number;
  candidates: StylistSelectionCandidate[];
}

export interface StylistSelectionPick {
  id: string;
  name: string;
  layer: string;
  reason: string;
  /** 1-based rank in that slot's candidates by similarity; null if not in list */
  rankAmongCandidates: number | null;
  inTop1: boolean;
  inTop3: boolean;
  isNewItem: boolean;
}

export interface StylistSelectionSlotLog {
  slot: string;
  matchStatus?: SlotMatchAssessment['status'];
  bestSimilarity?: number;
  candidates: StylistSelectionCandidate[];
  selected: StylistSelectionPick[];
  /** 该槽有召回且方案用了 new_item（同 layer） */
  usedNewItemDespiteCandidates: boolean;
}

export interface StylistSelectionOutfitLog {
  outfitId: string;
  slots: StylistSelectionSlotLog[];
  /** 选中衣橱 id 但不在任何槽候选里（锚点或幻觉） */
  offListWardrobeIds: string[];
}

export interface StylistSelectionAuditInput {
  result: StylistResult;
  slotSnapshots: StylistSelectionSlotSnapshot[];
  requestType?: string;
  conversationId?: string;
  messageId?: string;
  userMessage?: string;
}

const LAYER_TO_SLOT: Record<string, WardrobeSearchSlot> = {
  top: 'top',
  inner_top: 'top',
  bottom: 'bottom',
  dress: 'dress',
  one_piece: 'dress',
  shoes: 'shoes',
  footwear: 'shoes',
  outerwear: 'outerwear',
  accessory: 'accessory',
};

export function layerToSearchSlot(layer: string): WardrobeSearchSlot | undefined {
  return LAYER_TO_SLOT[layer.trim().toLowerCase()];
}

function rankAmongCandidates(
  selectedId: string,
  candidates: StylistSelectionCandidate[]
): number | null {
  const sorted = [...candidates].sort((a, b) => b.similarity - a.similarity);
  const idx = sorted.findIndex((c) => c.id === selectedId);
  return idx >= 0 ? idx + 1 : null;
}

/**
 * 对照 RAG 槽位候选与 Stylist 最终选品，供 audit 日志使用。
 */
export function buildStylistSelectionAudit(input: StylistSelectionAuditInput): {
  timestamp: string;
  conversationId?: string;
  messageId?: string;
  requestType?: string;
  userMessage?: string;
  outfits: StylistSelectionOutfitLog[];
  summary: {
    wardrobePickCount: number;
    newItemCount: number;
    inTop1Count: number;
    inTop3Count: number;
    offListCount: number;
    weakOrNoneHardPickCount: number;
  };
} {
  const candidateIdSet = new Set(
    input.slotSnapshots.flatMap((s) => s.candidates.map((c) => c.id))
  );

  const outfits: StylistSelectionOutfitLog[] = input.result.outfits.map((outfit) => {
    const offListWardrobeIds: string[] = [];
    for (const item of outfit.selected_items) {
      if (item.id === 'new_item') continue;
      if (!candidateIdSet.has(item.id)) {
        offListWardrobeIds.push(item.id);
      }
    }

    const slots: StylistSelectionSlotLog[] = input.slotSnapshots.map((snap) => {
      const candidateIds = new Set(snap.candidates.map((c) => c.id));
      const selectedInSlot = outfit.selected_items.filter((item) => {
        if (item.id !== 'new_item' && candidateIds.has(item.id)) return true;
        const slot = layerToSearchSlot(item.layer);
        return slot === snap.slot;
      });

      const selected: StylistSelectionPick[] = selectedInSlot.map((item) => {
        const isNewItem = item.id === 'new_item';
        const rank = isNewItem ? null : rankAmongCandidates(item.id, snap.candidates);
        return {
          id: item.id,
          name: item.name,
          layer: item.layer,
          reason: item.reason,
          rankAmongCandidates: rank,
          inTop1: rank === 1,
          inTop3: rank !== null && rank <= 3,
          isNewItem,
        };
      });

      const usedNewItemDespiteCandidates =
        snap.candidates.length > 0 &&
        selected.some((s) => s.isNewItem) &&
        !selected.some((s) => !s.isNewItem && candidateIds.has(s.id));

      return {
        slot: snap.slot,
        matchStatus: snap.matchStatus,
        bestSimilarity: snap.bestSimilarity,
        candidates: [...snap.candidates].sort((a, b) => b.similarity - a.similarity),
        selected,
        usedNewItemDespiteCandidates,
      };
    });

    return { outfitId: outfit.id, slots, offListWardrobeIds };
  });

  let wardrobePickCount = 0;
  let newItemCount = 0;
  let inTop1Count = 0;
  let inTop3Count = 0;
  let weakOrNoneHardPickCount = 0;
  let offListCount = 0;

  for (const outfit of outfits) {
    offListCount += outfit.offListWardrobeIds.length;
    for (const slot of outfit.slots) {
      for (const pick of slot.selected) {
        if (pick.isNewItem) {
          newItemCount += 1;
          continue;
        }
        wardrobePickCount += 1;
        if (pick.inTop1) inTop1Count += 1;
        if (pick.inTop3) inTop3Count += 1;
        if (
          (slot.matchStatus === 'weak' || slot.matchStatus === 'none') &&
          pick.rankAmongCandidates !== null
        ) {
          weakOrNoneHardPickCount += 1;
        }
      }
    }
  }

  return {
    timestamp: new Date().toISOString(),
    conversationId: input.conversationId,
    messageId: input.messageId,
    requestType: input.requestType,
    userMessage: input.userMessage,
    outfits,
    summary: {
      wardrobePickCount,
      newItemCount,
      inTop1Count,
      inTop3Count,
      offListCount,
      weakOrNoneHardPickCount,
    },
  };
}
