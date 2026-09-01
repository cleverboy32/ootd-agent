export interface CopywriterTagContext {
  wardrobeIds: Set<string>;
  outfitIds: Set<string>;
}

interface StylistLikeResult {
  outfits: Array<{
    id: string;
    selected_items: Array<{ id: string }>;
  }>;
}

const INCOMPLETE_TAG_TAIL =
  /(?:\{\{[^}]*|\[衣橱物品[^\]]*|\[IMAGE[^\]]*|\[image[^\]]*|【衣橱物品[^】]*)$/i;

export function buildCopywriterTagContext(stylistResult: StylistLikeResult): CopywriterTagContext {
  const wardrobeIds = new Set<string>();
  const outfitIds = new Set<string>();

  for (const outfit of stylistResult.outfits) {
    outfitIds.add(outfit.id);
    for (const item of outfit.selected_items) {
      if (item.id && item.id !== 'new_item') {
        wardrobeIds.add(item.id);
      }
    }
  }

  return { wardrobeIds, outfitIds };
}

function warnUnknownId(kind: 'wardrobe' | 'outfit', id: string): void {
  console.warn(`[COPYWRITER_SANITIZER] Unknown ${kind} id not in stylist result: ${id}`);
}

/**
 * Recover a stylist wardrobe id from a garbled Copywriter id.
 * Common failure: short insertions (e.g. inserted "g5" mid-cuid) causing Item not found.
 */
export function resolveWardrobeIdAgainstAllowlist(
  rawId: string,
  wardrobeIds: Set<string>
): string | null {
  const trimmed = rawId.trim();
  if (!trimmed) return null;
  if (wardrobeIds.has(trimmed)) return trimmed;

  const substringHits = [...wardrobeIds].filter(
    (id) => trimmed.includes(id) || id.includes(trimmed)
  );
  if (substringHits.length === 1) {
    console.warn(
      `[COPYWRITER_SANITIZER] Recovered garbled wardrobe id: ${trimmed} → ${substringHits[0]}`
    );
    return substringHits[0];
  }

  const insertionHits = [...wardrobeIds].filter((id) => isShortInsertionOf(trimmed, id));
  if (insertionHits.length === 1) {
    console.warn(
      `[COPYWRITER_SANITIZER] Recovered garbled wardrobe id: ${trimmed} → ${insertionHits[0]}`
    );
    return insertionHits[0];
  }

  warnUnknownId('wardrobe', trimmed);
  return null;
}

/** True when `garbled` equals `canonical` plus at most 3 inserted characters. */
function isShortInsertionOf(garbled: string, canonical: string, maxInsert = 3): boolean {
  if (garbled.length < canonical.length) return false;
  if (garbled.length - canonical.length > maxInsert) return false;

  let gi = 0;
  let ci = 0;
  let insertions = 0;
  while (gi < garbled.length && ci < canonical.length) {
    if (garbled[gi] === canonical[ci]) {
      gi += 1;
      ci += 1;
      continue;
    }
    gi += 1;
    insertions += 1;
    if (insertions > maxInsert) return false;
  }
  insertions += garbled.length - gi;
  return ci === canonical.length && insertions <= maxInsert;
}

function toWardrobeTag(id: string, context: CopywriterTagContext): string {
  const resolved = resolveWardrobeIdAgainstAllowlist(id, context.wardrobeIds);
  if (!resolved) {
    // Drop the tag so the frontend never requests a 404 "Item not found".
    return '';
  }
  return `[衣橱物品:id=${resolved}]`;
}

function toImageTag(id: string, context: CopywriterTagContext): string {
  const trimmed = id.trim();
  if (!context.outfitIds.has(trimmed)) {
    warnUnknownId('outfit', trimmed);
  }
  return `[IMAGE=${trimmed}]`;
}

/**
 * Normalize all known wardrobe / image tag variants to canonical frontend format.
 * Source of truth for valid ids is stylistResult (via context).
 * Unknown / unrecoverable wardrobe ids are removed (not emitted).
 */
export function sanitizeCopywriterTags(text: string, context: CopywriterTagContext): string {
  let result = text;

  // Preferred LLM tokens
  result = result.replace(/\{\{\s*W\s*:\s*([^}]+?)\s*\}\}/gi, (_, id) => toWardrobeTag(id, context));
  result = result.replace(
    /\{\{\s*(?:WARDROBE|衣橱物品)\s*:\s*([^}]+?)\s*\}\}/gi,
    (_, id) => toWardrobeTag(id, context)
  );
  result = result.replace(
    /\{\{\s*(?:IMG|IMAGE)\s*:\s*([^}]+?)\s*\}\}/gi,
    (_, id) => toImageTag(id, context)
  );

  // Legacy / drifted wardrobe markdown tags
  result = result.replace(
    /[【\[]衣橱物品\s*:\s*(?:id\s*=\s*)?([^\]】]+)[\]】]/gi,
    (_, id) => toWardrobeTag(id, context)
  );

  // Legacy / drifted image placeholders
  result = result.replace(
    /\[IMAGE\s*[=:]\s*([^\]]+)\]/gi,
    (_, id) => toImageTag(id, context)
  );

  // Collapse awkward double spaces left by dropped tags (keep newlines)
  result = result.replace(/[^\S\n]{2,}/g, ' ');

  return result;
}

export function createCopywriterStreamSanitizer(context: CopywriterTagContext) {
  let pending = '';

  return {
    process(chunk: string): string {
      const combined = pending + chunk;
      const safeEnd = findSafeFlushIndex(combined);
      const toFlush = combined.slice(0, safeEnd);
      pending = combined.slice(safeEnd);
      return sanitizeCopywriterTags(toFlush, context);
    },
    flush(): string {
      const rest = sanitizeCopywriterTags(pending, context);
      pending = '';
      return rest;
    },
  };
}

function findSafeFlushIndex(text: string): number {
  const match = INCOMPLETE_TAG_TAIL.exec(text);
  if (!match) return text.length;
  return match.index;
}
