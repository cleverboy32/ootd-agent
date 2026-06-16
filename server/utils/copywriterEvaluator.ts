import { buildCopywriterTagContext } from './copywriterTagSanitizer';

export type CopywriterEvalSeverity = 'error' | 'warn';

export interface CopywriterEvalIssue {
  code: string;
  severity: CopywriterEvalSeverity;
  message: string;
}

export interface CopywriterEvalResult {
  passed: boolean;
  score: number;
  issues: CopywriterEvalIssue[];
  stats: {
    requiredWardrobeTags: number;
    foundWardrobeTags: number;
    requiredImagePlaceholders: number;
    foundImagePlaceholders: number;
    newItemCount: number;
    hasNewItemMarker: boolean;
  };
}

interface StylistLikeResult {
  outfits: Array<{
    id: string;
    selected_items: Array<{ id: string; name?: string }>;
  }>;
}

const WARDROBE_TAG_RE = /\[衣橱物品:id=([^\]]+)\]/g;
const IMAGE_TAG_RE = /\[IMAGE=([^\]]+)\]/gi;

const LETTER_STYLE_RE =
  /展信佳|此致敬礼|顺祝(?:商祺|时祺|夏安|冬安)|敬祝|谨启|惠鉴|手书|肃启|俯颂|顺颂|如晤|钧安/i;

const FORMAL_OPENING_RE = /^(尊敬的|敬爱的|您好，(?:很)?高兴为您)/;

const RESIDUAL_TOKEN_RES = [
  /\{\{\s*W\s*:/i,
  /\{\{\s*(?:WARDROBE|衣橱物品)\s*:/i,
  /\{\{\s*(?:IMG|IMAGE)\s*:/i,
  /[【\[]衣橱物品\s*:(?!id=)/i,
  /\[IMAGE\s*:/i,
];

function collectMatches(text: string, re: RegExp): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(re)) {
    ids.push(match[1].trim());
  }
  return ids;
}

function countNewItems(stylistResult: StylistLikeResult): number {
  let count = 0;
  for (const outfit of stylistResult.outfits) {
    for (const item of outfit.selected_items) {
      if (item.id === 'new_item') count += 1;
    }
  }
  return count;
}

/**
 * L1 deterministic evaluation of sanitized copywriter output against stylist ground truth.
 */
export function evaluateCopywriterOutput(
  text: string,
  stylistResult: StylistLikeResult
): CopywriterEvalResult {
  const context = buildCopywriterTagContext(stylistResult);
  const issues: CopywriterEvalIssue[] = [];

  const foundWardrobeIds = collectMatches(text, WARDROBE_TAG_RE);
  const foundImageIds = collectMatches(text, IMAGE_TAG_RE);
  const foundWardrobeSet = new Set(foundWardrobeIds);
  const foundImageSet = new Set(foundImageIds);

  const requiredWardrobeIds = [...context.wardrobeIds];
  const requiredOutfitIds = [...context.outfitIds];
  const newItemCount = countNewItems(stylistResult);
  const hasNewItemMarker = text.includes('🛍️');

  for (const id of requiredWardrobeIds) {
    if (!foundWardrobeSet.has(id)) {
      issues.push({
        code: 'MISSING_WARDROBE_TAG',
        severity: 'error',
        message: `Missing wardrobe tag for stylist item id=${id}`,
      });
    }
  }

  for (const id of requiredOutfitIds) {
    if (!foundImageSet.has(id)) {
      issues.push({
        code: 'MISSING_IMAGE_PLACEHOLDER',
        severity: 'error',
        message: `Missing image placeholder for outfit id=${id}`,
      });
    }
  }

  for (const id of foundWardrobeIds) {
    if (!context.wardrobeIds.has(id)) {
      issues.push({
        code: 'UNKNOWN_WARDROBE_ID',
        severity: 'error',
        message: `Wardrobe tag references unknown id=${id}`,
      });
    }
  }

  for (const id of foundImageIds) {
    if (!context.outfitIds.has(id)) {
      issues.push({
        code: 'UNKNOWN_OUTFIT_ID',
        severity: 'error',
        message: `Image placeholder references unknown outfit id=${id}`,
      });
    }
  }

  for (const pattern of RESIDUAL_TOKEN_RES) {
    if (pattern.test(text)) {
      issues.push({
        code: 'RESIDUAL_RAW_TOKEN',
        severity: 'error',
        message: `Unresolved copywriter token remains in output (${pattern})`,
      });
      break;
    }
  }

  if (newItemCount > 0 && !hasNewItemMarker) {
    issues.push({
      code: 'MISSING_NEW_ITEM_MARKER',
      severity: 'warn',
      message: `Stylist selected ${newItemCount} new_item(s) but copywriter text has no 🛍️ marker`,
    });
  }

  if (LETTER_STYLE_RE.test(text)) {
    issues.push({
      code: 'LETTER_STYLE_CLOSING',
      severity: 'warn',
      message: 'Copywriter used formal letter-style closing (e.g. 展信佳)',
    });
  }

  const firstLine = text.trim().split('\n')[0]?.trim() ?? '';
  if (FORMAL_OPENING_RE.test(firstLine)) {
    issues.push({
      code: 'FORMAL_OPENING',
      severity: 'warn',
      message: 'Copywriter used formal letter-style opening',
    });
  }

  if (foundImageSet.size > requiredOutfitIds.length) {
    issues.push({
      code: 'EXTRA_IMAGE_PLACEHOLDER',
      severity: 'warn',
      message: `Found ${foundImageSet.size} image placeholders but stylist has ${requiredOutfitIds.length} outfit(s)`,
    });
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warn').length;
  const score = Math.max(0, 100 - errorCount * 20 - warnCount * 5);

  return {
    passed: errorCount === 0,
    score,
    issues,
    stats: {
      requiredWardrobeTags: requiredWardrobeIds.length,
      foundWardrobeTags: foundWardrobeSet.size,
      requiredImagePlaceholders: requiredOutfitIds.length,
      foundImagePlaceholders: foundImageSet.size,
      newItemCount,
      hasNewItemMarker,
    },
  };
}
