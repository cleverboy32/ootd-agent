import { ClothingMainCategory } from '@prisma/client';
import { searchWardrobeItemsByText } from '@/server/services/wardrobeService';
import { inferAnchorSlotFromSummary } from '@/app/api/generate-with-image/handlers/intentTypes';
import type {
  AnchorSlot,
  WardrobeAnchorCandidate,
  WardrobeResolverResult,
} from '@/app/api/generate-with-image/handlers/intentTypes';

export type { WardrobeResolverResult };

const RESOLVE_THRESHOLD = 0.72;
const AMBIGUOUS_MIN = 0.52;
const MAX_CANDIDATES = 4;

function slotToMainCategory(slot: AnchorSlot): ClothingMainCategory | undefined {
  const map: Record<AnchorSlot, ClothingMainCategory> = {
    top: 'TOP',
    bottom: 'BOTTOM',
    dress: 'ONE_PIECE',
    shoes: 'FOOTWEAR',
    outerwear: 'OUTERWEAR',
    accessory: 'ACCESSORY',
  };
  return map[slot];
}

function toCandidate(item: {
  id: string;
  imageUrl: string;
  subCategory: string;
  colors: string[];
  similarity: number;
}): WardrobeAnchorCandidate {
  return {
    id: item.id,
    imageUrl: item.imageUrl,
    subCategory: item.subCategory,
    colors: item.colors,
    similarity: item.similarity,
  };
}

/**
 * Resolve a user-described wardrobe item to a concrete ClothingItem id.
 */
export async function resolveWardrobeAnchor(
  clientId: string,
  summary: string,
  slot?: AnchorSlot | ''
): Promise<WardrobeResolverResult> {
  const query = summary.trim();
  if (!query || !clientId) {
    return { status: 'not_found' };
  }

  const inferredSlot = inferAnchorSlotFromSummary(query);
  let effectiveSlot: AnchorSlot | '' = slot || '';
  if (inferredSlot && effectiveSlot && inferredSlot !== effectiveSlot) {
    console.warn(
      `[WARDROBE_RESOLVER] Overriding anchor_slot ${effectiveSlot} → ${inferredSlot} for "${query.slice(0, 32)}..."`
    );
    effectiveSlot = inferredSlot;
  } else if (inferredSlot && !effectiveSlot) {
    effectiveSlot = inferredSlot;
  }

  const mainCategory = effectiveSlot ? slotToMainCategory(effectiveSlot) : undefined;
  const results = await searchWardrobeItemsByText(query, clientId, MAX_CANDIDATES + 1, mainCategory);

  if (results.length === 0 && mainCategory) {
    const fallback = await searchWardrobeItemsByText(query, clientId, MAX_CANDIDATES + 1);
    return classifyResults(fallback);
  }

  return classifyResults(results);
}

function classifyResults(
  results: Array<{
    id: string;
    imageUrl: string;
    subCategory: string;
    colors: string[];
    similarity: number;
  }>
): WardrobeResolverResult {
  if (results.length === 0) {
    return { status: 'not_found' };
  }

  const sorted = [...results].sort((a, b) => b.similarity - a.similarity);
  const top = sorted[0];
  const candidates = sorted
    .filter((r) => r.similarity >= AMBIGUOUS_MIN)
    .slice(0, MAX_CANDIDATES)
    .map(toCandidate);

  if (top.similarity >= RESOLVE_THRESHOLD && candidates.length === 1) {
    return { status: 'resolved', itemId: top.id, item: toCandidate(top) };
  }

  if (top.similarity >= RESOLVE_THRESHOLD && candidates.length > 1) {
    const second = candidates[1];
    if (top.similarity - (second.similarity ?? 0) >= 0.08) {
      return { status: 'resolved', itemId: top.id, item: toCandidate(top) };
    }
  }

  if (candidates.length >= 1) {
    return { status: 'ambiguous', candidates };
  }

  return { status: 'not_found' };
}
