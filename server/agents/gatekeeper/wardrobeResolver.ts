import { ClothingMainCategory } from '@prisma/client';
import { searchWardrobeItemsByText } from '@/server/services/wardrobeService';
import { inferAnchorSlotFromSummary } from '@/server/agents/intent';
import { filterItemsByQueryColor } from '@/server/utils/queryColorMatch';
import type {
  AnchorSlot,
  WardrobeAnchorCandidate,
  WardrobeResolverResult,
} from '@/server/agents/intent';

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
  slot?: AnchorSlot | '',
  /** Gatekeeper LLM 直接生成的精简检索词，优先使用 */
  llmSearchQuery?: string
): Promise<WardrobeResolverResult> {
  const query = (llmSearchQuery?.trim() || summary.trim());
  if (!query || !clientId) {
    return { status: 'not_found' };
  }
  if (llmSearchQuery?.trim() && llmSearchQuery.trim() !== summary.trim()) {
    console.log(
      `[WARDROBE_RESOLVER] Using LLM search query: "${llmSearchQuery}" (summary: "${summary.slice(0, 32)}")`
    );
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
  const rawResults = await searchWardrobeItemsByText(query, clientId, MAX_CANDIDATES + 1, mainCategory);

  let results = rawResults;
  if (results.length === 0 && mainCategory) {
    results = await searchWardrobeItemsByText(query, clientId, MAX_CANDIDATES + 1);
  }

  const { matched, rejected } = filterItemsByQueryColor(query, results);
  if (matched.length === 0 && rejected.length > 0) {
    const nearMiss = toCandidate(
      [...rejected].sort((a, b) => b.similarity - a.similarity)[0]
    );
    console.warn(
      `[WARDROBE_RESOLVER] Color mismatch for "${query.slice(0, 32)}": nearMiss colors=${nearMiss.colors.join(',')}`
    );
    return { status: 'color_mismatch', queriedSummary: query, nearMiss };
  }

  return classifyResults(matched);
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
