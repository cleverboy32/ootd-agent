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

function toWardrobeTag(id: string, context: CopywriterTagContext): string {
  const trimmed = id.trim();
  if (!context.wardrobeIds.has(trimmed)) {
    warnUnknownId('wardrobe', trimmed);
  }
  return `[衣橱物品:id=${trimmed}]`;
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
