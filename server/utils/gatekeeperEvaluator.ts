import type { GatekeeperIntent, OutfitRequestType } from '@/app/api/generate-with-image/handlers/intentTypes';
import {
  inferAnchorSlotFromSummary,
  isOutfitGeneratingIntent,
  isPurchasePairingAnchorReady,
  isPurchasePairingIntent,
  isWardrobePairingAnchorReady,
  isWardrobePairingIntent,
  parseDressingClimate,
  inferDressingClimateFromAnchor,
  userMentionedOutfitIdInText,
} from '@/app/api/generate-with-image/handlers/intentTypes';

export type GatekeeperEvalSeverity = 'error' | 'warn';

export interface GatekeeperEvalIssue {
  code: string;
  severity: GatekeeperEvalSeverity;
  message: string;
}

export interface GatekeeperEvalResult {
  passed: boolean;
  score: number;
  issues: GatekeeperEvalIssue[];
  stats: {
    requestType: OutfitRequestType;
    isComplete: boolean;
    hasGatekeeperReply: boolean;
    followupCount: number;
    anchorReady: boolean;
    weatherLookupNeeded?: boolean;
  };
}

export interface GatekeeperEvalInput {
  is_complete: boolean;
  extracted_intent: GatekeeperIntent;
  followup_questions: string[];
  gatekeeper_reply?: string;
  wardrobe_candidates?: unknown[];
}

export interface GatekeeperEvalContext {
  contextText?: string;
  currentMessageText?: string;
  weatherLookup?: { needed: boolean; city: string };
}

const MULTIPLE_OUTFITS_IN_CONTEXT = /方案二|第二套|outfit_2|第\s*2\s*套|两套方案|两套穿搭|准备了\s*2\s*套|两套/;

const VALID_REQUEST_TYPES = new Set<OutfitRequestType>([
  'wardrobe_outfit',
  'wardrobe_pairing',
  'purchase_pairing',
  'feedback_revision',
  'outfit_selection',
  'outfit_confirmed',
  'clarify',
]);

const SHORT_CIRCUIT_TYPES = new Set<OutfitRequestType>([
  'clarify',
  'outfit_selection',
  'outfit_confirmed',
]);

function hasNonEmptyReply(reply?: string): boolean {
  return Boolean(reply?.trim());
}

function hasFollowups(questions: string[]): boolean {
  return questions.some((q) => q.trim());
}

function styleMentionedInContext(style: string, contextText: string): boolean {
  const normalized = style.trim();
  if (!normalized || normalized === '日常休闲') return true;
  if (!contextText.trim()) return false;
  const tokens = normalized.split(/[、,，/\s]+/).filter(Boolean);
  return tokens.some((token) => contextText.includes(token));
}

function cityMentionedInContext(city: string | undefined, contextText: string): boolean {
  const normalized = city?.trim();
  if (!normalized) return true;
  return contextText.includes(normalized);
}

function userStatedWeather(contextText: string): boolean {
  return /天气|气温|温度|下雨|下雪|刮风|晴|阴|冷|热|\d+\s*度/.test(contextText);
}

function appendAnchorSlotMislabelWarnings(intent: GatekeeperIntent, issues: GatekeeperEvalIssue[]): void {
  if (intent.anchor_slot === 'top') {
    const inferred = inferAnchorSlotFromSummary(intent.anchor_item_summary);
    if (inferred === 'accessory') {
      issues.push({
        code: 'ACCESSORY_SLOT_MISLABEL',
        severity: 'warn',
        message: 'Accessory item appears mislabeled as top anchor_slot',
      });
    }
  }
  if (intent.anchor_slot === 'dress') {
    const inferred = inferAnchorSlotFromSummary(intent.anchor_item_summary);
    if (inferred === 'outerwear') {
      issues.push({
        code: 'OUTERWEAR_SLOT_MISLABEL',
        severity: 'warn',
        message: 'Outerwear item appears mislabeled as dress anchor_slot',
      });
    }
  }
}

function appendDressingClimateWarnings(
  intent: GatekeeperIntent,
  isComplete: boolean,
  issues: GatekeeperEvalIssue[]
): void {
  if (!isComplete || !isOutfitGeneratingIntent(intent)) return;

  if (!parseDressingClimate(intent.dressing_climate)) {
    issues.push({
      code: 'MISSING_DRESSING_CLIMATE',
      severity: 'warn',
      message: 'Outfit flow marked complete but dressing_climate is empty',
    });
  }

  const fromAnchor = inferDressingClimateFromAnchor(intent);
  const current = parseDressingClimate(intent.dressing_climate);
  if (
    current &&
    fromAnchor &&
    ((fromAnchor === 'cold' && current === 'warm') || (fromAnchor === 'warm' && current === 'cold'))
  ) {
    issues.push({
      code: 'DRESSING_CLIMATE_ANCHOR_MISMATCH',
      severity: 'warn',
      message: `dressing_climate "${current}" conflicts with cold/warm anchor summary`,
    });
  }
}

/**
 * L1 deterministic evaluation of finalized Gatekeeper output.
 */
export function evaluateGatekeeperOutput(
  result: GatekeeperEvalInput,
  ctx: GatekeeperEvalContext = {}
): GatekeeperEvalResult {
  const intent = result.extracted_intent;
  const requestType = intent.request_type;
  const issues: GatekeeperEvalIssue[] = [];
  const contextText = ctx.contextText?.trim() ?? '';
  const hasReply = hasNonEmptyReply(result.gatekeeper_reply);
  const hasFollowupQuestions = hasFollowups(result.followup_questions);

  if (!VALID_REQUEST_TYPES.has(requestType)) {
    issues.push({
      code: 'INVALID_REQUEST_TYPE',
      severity: 'error',
      message: `Unknown request_type: ${String(requestType)}`,
    });
  }

  if (SHORT_CIRCUIT_TYPES.has(requestType) && result.is_complete) {
    issues.push({
      code: 'SHORT_CIRCUIT_MARKED_COMPLETE',
      severity: 'error',
      message: `${requestType} must not be marked complete`,
    });
  }

  if (SHORT_CIRCUIT_TYPES.has(requestType)) {
    if (!hasReply) {
      issues.push({
        code: 'SHORT_CIRCUIT_MISSING_REPLY',
        severity: 'error',
        message: `${requestType} requires gatekeeper_reply when incomplete`,
      });
    }
    if (hasFollowupQuestions) {
      issues.push({
        code: 'SHORT_CIRCUIT_HAS_FOLLOWUPS',
        severity: 'error',
        message: `${requestType} should use gatekeeper_reply, not followup_questions`,
      });
    }
  }

  if (requestType === 'outfit_selection' && !intent.selected_outfit_id?.trim()) {
    issues.push({
      code: 'SELECTION_MISSING_OUTFIT_ID',
      severity: 'warn',
      message: 'outfit_selection is missing selected_outfit_id',
    });
  }

  if (requestType === 'feedback_revision' && !result.is_complete) {
    issues.push({
      code: 'FEEDBACK_NOT_COMPLETE',
      severity: 'error',
      message: 'feedback_revision should always be marked complete',
    });
  }

  if (requestType === 'feedback_revision' && !intent.special_requests.trim()) {
    issues.push({
      code: 'FEEDBACK_MISSING_REVISION',
      severity: 'warn',
      message: 'feedback_revision has empty special_requests',
    });
  }

  const currentMessageText = ctx.currentMessageText?.trim() ?? '';
  if (
    requestType === 'feedback_revision' &&
    result.is_complete &&
    intent.selected_outfit_id?.trim() &&
    currentMessageText &&
    !userMentionedOutfitIdInText(currentMessageText) &&
    MULTIPLE_OUTFITS_IN_CONTEXT.test(contextText)
  ) {
    issues.push({
      code: 'REVISION_OUTFIT_ID_NOT_STATED',
      severity: 'warn',
      message:
        'feedback_revision marked complete with selected_outfit_id but user did not state which outfit',
    });
  }

  if (isWardrobePairingIntent(intent)) {
    if (result.is_complete && !isWardrobePairingAnchorReady(intent)) {
      issues.push({
        code: 'WARDROBE_PAIRING_INCOMPLETE_ANCHOR',
        severity: 'error',
        message: 'wardrobe_pairing marked complete but anchor_wardrobe_id or anchor_slot is missing',
      });
    }
    if (!result.is_complete && !hasReply && !hasFollowupQuestions && !result.wardrobe_candidates?.length) {
      issues.push({
        code: 'WARDROBE_PAIRING_MISSING_FOLLOWUP',
        severity: 'error',
        message: 'Incomplete wardrobe_pairing must provide followup, reply, or wardrobe_candidates',
      });
    }
    if (result.is_complete && !intent.occasion.trim()) {
      issues.push({
        code: 'WARDROBE_PAIRING_MISSING_OCCASION',
        severity: 'error',
        message: 'wardrobe_pairing marked complete but occasion is empty',
      });
    }
    appendAnchorSlotMislabelWarnings(intent, issues);
    if (result.is_complete) {
      appendDressingClimateWarnings(intent, result.is_complete, issues);
    }
  }

  if (isPurchasePairingIntent(intent)) {
    if (result.is_complete && !isPurchasePairingAnchorReady(intent)) {
      issues.push({
        code: 'PURCHASE_PAIRING_INCOMPLETE_ANCHOR',
        severity: 'error',
        message: 'purchase_pairing marked complete but anchor_item_summary or anchor_slot is missing',
      });
    }
    if (!result.is_complete && !hasReply && !hasFollowupQuestions) {
      issues.push({
        code: 'PURCHASE_PAIRING_MISSING_FOLLOWUP',
        severity: 'error',
        message: 'Incomplete purchase_pairing must provide followup_questions or gatekeeper_reply',
      });
    }
    appendAnchorSlotMislabelWarnings(intent, issues);
    if (result.is_complete) {
      appendDressingClimateWarnings(intent, result.is_complete, issues);
    }
  }

  if (requestType === 'wardrobe_outfit') {
    if (result.is_complete && !intent.occasion.trim()) {
      issues.push({
        code: 'WARDROBE_MISSING_OCCASION',
        severity: 'error',
        message: 'wardrobe_outfit marked complete but occasion is empty',
      });
    }
    if (!result.is_complete && !hasReply && !hasFollowupQuestions) {
      issues.push({
        code: 'WARDROBE_MISSING_FOLLOWUP',
        severity: 'error',
        message: 'Incomplete wardrobe_outfit must provide followup_questions or gatekeeper_reply',
      });
    }
    if (result.is_complete) {
      appendDressingClimateWarnings(intent, result.is_complete, issues);
    }
  }

  if (result.is_complete && hasFollowupQuestions) {
    issues.push({
      code: 'COMPLETE_WITH_FOLLOWUPS',
      severity: 'error',
      message: 'is_complete=true but followup_questions is non-empty',
    });
  }

  if (result.is_complete && hasReply && !SHORT_CIRCUIT_TYPES.has(requestType)) {
    issues.push({
      code: 'COMPLETE_WITH_GATEKEEPER_REPLY',
      severity: 'warn',
      message: 'is_complete=true but gatekeeper_reply is non-empty',
    });
  }

  if (result.is_complete && (result.wardrobe_candidates?.length ?? 0) > 0) {
    issues.push({
      code: 'COMPLETE_WITH_WARDROBE_CANDIDATES',
      severity: 'error',
      message: 'is_complete=true but wardrobe_candidates is non-empty',
    });
  }

  if (contextText) {
    if (!styleMentionedInContext(intent.style_preference, contextText)) {
      issues.push({
        code: 'STYLE_NOT_IN_CONTEXT',
        severity: 'warn',
        message: `style_preference "${intent.style_preference}" not found in user context`,
      });
    }
    if (!cityMentionedInContext(intent.city, contextText)) {
      issues.push({
        code: 'CITY_NOT_IN_CONTEXT',
        severity: 'warn',
        message: `city "${intent.city}" not found in user context`,
      });
    }
  }

  if (ctx.weatherLookup) {
    const { needed } = ctx.weatherLookup;
    if (needed && SHORT_CIRCUIT_TYPES.has(requestType)) {
      issues.push({
        code: 'UNNECESSARY_WEATHER_LOOKUP',
        severity: 'warn',
        message: `${requestType} should not request weather lookup`,
      });
    }
    if (needed && isPurchasePairingIntent(intent)) {
      issues.push({
        code: 'PURCHASE_PAIRING_WEATHER_LOOKUP',
        severity: 'warn',
        message: 'purchase_pairing should not request weather lookup',
      });
    }
    if (needed && userStatedWeather(contextText)) {
      issues.push({
        code: 'WEATHER_LOOKUP_AFTER_USER_STATED',
        severity: 'warn',
        message: 'weather_lookup.needed=true but user already stated weather/temperature',
      });
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warn').length;
  const score = Math.max(0, 100 - errorCount * 20 - warnCount * 5);

  return {
    passed: errorCount === 0,
    score,
    issues,
    stats: {
      requestType,
      isComplete: result.is_complete,
      hasGatekeeperReply: hasReply,
      followupCount: result.followup_questions.filter((q) => q.trim()).length,
      anchorReady: isPurchasePairingAnchorReady(intent) || isWardrobePairingAnchorReady(intent),
      weatherLookupNeeded: ctx.weatherLookup?.needed,
    },
  };
}
