import type { UserProfileResult } from '@/server/agents/user-profile';
import { isVisualProfileVerified } from '@/server/utils/userProfileVisual';
import { extractConfirmedWardrobeId } from '@/server/agents/intent';

export type UserProfileEvalSeverity = 'error' | 'warn';

export interface UserProfileEvalIssue {
  code: string;
  severity: UserProfileEvalSeverity;
  message: string;
}

export interface UserProfileEvalResult {
  passed: boolean;
  score: number;
  issues: UserProfileEvalIssue[];
  stats: {
    previousPreferenceCount: number;
    resultPreferenceCount: number;
    hasVisualData: boolean;
    visualInferenceBlocked: boolean;
    fieldsPreserved: {
      height: boolean;
      weight: boolean;
      name: boolean;
      preferences: boolean;
    };
  };
}

export interface UserProfileEvalInput {
  previousProfile: Record<string, unknown>;
  result: UserProfileResult;
  /** applyVerifiedVisualFields 之前的模型原始输出 */
  rawParsed?: UserProfileResult;
  contextText?: string;
  currentMessageText?: string;
  skippedAgent?: boolean;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function contextMentionsHeight(text: string): boolean {
  return /身高|多高|\d{2,3}\s*cm|长高|变矮|个子/i.test(text);
}

function contextMentionsWeight(text: string): boolean {
  return /体重|多重|\d{2,3}\s*kg|瘦了|胖了|斤|公斤/i.test(text);
}

function contextMentionsName(text: string): boolean {
  return /我叫|叫我|昵称|名字是/i.test(text);
}

function hasStoredVisualData(profile: Record<string, unknown>): boolean {
  const visual = profile.visual_features as UserProfileResult['visual_features'] | undefined;
  return Boolean(
    asString(profile.skin_tone) ||
      asString(profile.body_shape) ||
      (visual?.hair_color && visual.hair_color !== 'unknown') ||
      (visual?.detected_features && visual.detected_features !== 'none')
  );
}

function hasDuplicatePreferences(preferences: string[]): boolean {
  const seen = new Set<string>();
  for (const pref of preferences) {
    const key = pref.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

/**
 * L1 deterministic evaluation of User Profile Agent merge output.
 */
export function evaluateUserProfileOutput(input: UserProfileEvalInput): UserProfileEvalResult {
  const {
    previousProfile,
    result,
    rawParsed,
    contextText = '',
    currentMessageText = '',
    skippedAgent = false,
  } = input;
  const issues: UserProfileEvalIssue[] = [];

  const prevHeight = asString(previousProfile.height);
  const prevWeight = asString(previousProfile.weight);
  const prevName = asString(previousProfile.name);
  const prevPreferences = asStringArray(previousProfile.preferences);
  const prevPersonalStyle = asString(previousProfile.personal_style);

  const fieldsPreserved = {
    height: true,
    weight: true,
    name: true,
    preferences: true,
  };

  if (!result.personal_style?.trim()) {
    issues.push({
      code: 'MISSING_PERSONAL_STYLE',
      severity: 'error',
      message: 'personal_style is empty; expected at least "日常休闲"',
    });
  }

  if (!result.visual_features?.hair_color || !result.visual_features?.detected_features) {
    issues.push({
      code: 'INVALID_VISUAL_FEATURES',
      severity: 'error',
      message: 'visual_features must include hair_color and detected_features',
    });
  }

  if (prevHeight && !result.height?.trim() && !contextMentionsHeight(contextText)) {
    fieldsPreserved.height = false;
    issues.push({
      code: 'DATA_LOSS_HEIGHT',
      severity: 'warn',
      message: 'Previous height was cleared without user mentioning height in context',
    });
  }

  if (prevWeight && !result.weight?.trim() && !contextMentionsWeight(contextText)) {
    fieldsPreserved.weight = false;
    issues.push({
      code: 'DATA_LOSS_WEIGHT',
      severity: 'warn',
      message: 'Previous weight was cleared without user mentioning weight in context',
    });
  }

  if (prevName && !result.name?.trim() && !contextMentionsName(contextText)) {
    fieldsPreserved.name = false;
    issues.push({
      code: 'DATA_LOSS_NAME',
      severity: 'warn',
      message: 'Previous name was cleared without user mentioning name in context',
    });
  }

  if (prevPreferences.length > 0 && result.preferences.length === 0) {
    fieldsPreserved.preferences = false;
    issues.push({
      code: 'DATA_LOSS_PREFERENCES',
      severity: 'warn',
      message: `Previous preferences (${prevPreferences.length}) were cleared entirely`,
    });
  }

  if (hasDuplicatePreferences(result.preferences)) {
    issues.push({
      code: 'DUPLICATE_PREFERENCES',
      severity: 'warn',
      message: 'preferences array contains duplicate entries',
    });
  }

  const raw = rawParsed ?? result;
  const storedHadVisual = hasStoredVisualData(previousProfile);
  const verifiedVisual = isVisualProfileVerified(previousProfile);

  const visualInferenceBlocked =
    !skippedAgent &&
    !storedHadVisual &&
    Boolean(
      asString(raw.skin_tone) ||
        asString(raw.body_shape) ||
        (raw.visual_features?.hair_color && raw.visual_features.hair_color !== 'unknown') ||
        (raw.visual_features?.detected_features && raw.visual_features.detected_features !== 'none')
    );

  if (visualInferenceBlocked) {
    issues.push({
      code: 'VISUAL_INFERENCE_BLOCKED',
      severity: 'warn',
      message: 'Model attempted visual inference; stripped because visual_profile_verified is false',
    });
  }

  if (storedHadVisual && !verifiedVisual) {
    issues.push({
      code: 'UNVERIFIED_VISUAL_STRIPPED',
      severity: 'warn',
      message: 'Legacy visual profile data without visual_profile_verified was stripped',
    });
  }

  if (
    !skippedAgent &&
    extractConfirmedWardrobeId(currentMessageText) &&
    result.preferences.length > prevPreferences.length
  ) {
    issues.push({
      code: 'PREFERENCE_UPDATE_ON_CONFIRM',
      severity: 'warn',
      message: 'Profile agent expanded preferences on wardrobe picker confirmation turn',
    });
  }

  if (
    !skippedAgent &&
    raw.name?.trim() &&
    !prevName &&
    !contextMentionsName(contextText) &&
    !contextMentionsName(currentMessageText)
  ) {
    issues.push({
      code: 'NAME_WITHOUT_EXPLICIT_INTRO',
      severity: 'warn',
      message: `Model set name "${raw.name}" without explicit self-introduction in current turn`,
    });
  }

  if (
    prevPersonalStyle &&
    result.personal_style?.trim() &&
    result.personal_style !== prevPersonalStyle &&
    !contextText.includes(result.personal_style) &&
    result.personal_style !== '日常休闲'
  ) {
    issues.push({
      code: 'STYLE_CHANGED_WITHOUT_MENTION',
      severity: 'warn',
      message: `personal_style changed to "${result.personal_style}" without explicit mention in context`,
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
      previousPreferenceCount: prevPreferences.length,
      resultPreferenceCount: result.preferences.length,
      hasVisualData: Boolean(
        verifiedVisual &&
          (result.skin_tone.trim() ||
            result.body_shape.trim() ||
            (result.visual_features.hair_color && result.visual_features.hair_color !== 'unknown'))
      ),
      visualInferenceBlocked,
      fieldsPreserved,
    },
  };
}
