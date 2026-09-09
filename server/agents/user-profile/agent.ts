import { Content, Part } from '@google/genai';
import { llmGenerate } from '@/server/services/llm/client';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { evaluateUserProfileOutput } from '@/server/utils/userProfileEvaluator';
import { logUserProfileAudit } from '@/server/logging/userProfile';
import {
  applyVerifiedVisualFields,
  isVisualProfileVerified,
  readVerifiedVisualProfile,
} from '@/server/utils/userProfileVisual';
import { mergeChatProfileForPersistence } from '@/server/utils/profileMetadata';
import { extractConfirmedWardrobeId, type GatekeeperIntent } from '../intent';
import prismadb from 'server/db';
import { Prisma } from '@prisma/client';
import { userProfileSchema, UserProfileResult, UserProfileAuditContext } from './schema';
import { USER_PROFILE_SYSTEM_INSTRUCTION } from './prompts';

export type { UserProfileResult, UserProfileAuditContext } from './schema';

function buildProfileContextText(history: Content[], currentInput: Part[]): string {
  const chunks: string[] = [];
  for (const msg of history) {
    for (const part of msg.parts ?? []) {
      if ('text' in part && part.text?.trim()) {
        chunks.push(part.text.trim());
      }
    }
  }
  for (const part of currentInput) {
    if ('text' in part && part.text?.trim()) {
      chunks.push(part.text.trim());
    }
  }
  return chunks.join('\n');
}

function snapshotPreviousProfile(dbProfile: Record<string, unknown>) {
  const preferences = Array.isArray(dbProfile.preferences)
    ? dbProfile.preferences.filter((p): p is string => typeof p === 'string')
    : [];
  const visual = dbProfile.visual_features as UserProfileResult['visual_features'] | undefined;
  return {
    height: typeof dbProfile.height === 'string' ? dbProfile.height : '',
    weight: typeof dbProfile.weight === 'string' ? dbProfile.weight : '',
    name: typeof dbProfile.name === 'string' ? dbProfile.name : '',
    preferenceCount: preferences.length,
    personal_style: typeof dbProfile.personal_style === 'string' ? dbProfile.personal_style : '',
    hasVisualData: isVisualProfileVerified(dbProfile) && Boolean(
      (typeof dbProfile.skin_tone === 'string' && dbProfile.skin_tone.trim()) ||
        (typeof dbProfile.body_shape === 'string' && dbProfile.body_shape.trim()) ||
        (visual?.hair_color && visual.hair_color !== 'unknown')
    ),
  };
}

function normalizePersonalStyle(
  result: UserProfileResult,
  dbProfile: Record<string, unknown>
): UserProfileResult {
  if (result.personal_style?.trim()) return result;
  const fromDb = typeof dbProfile.personal_style === 'string' ? dbProfile.personal_style.trim() : '';
  return { ...result, personal_style: fromDb || '日常休闲' };
}

function extractTextParts(parts: Part[]): Part[] {
  return parts.filter((part): part is { text: string } => 'text' in part && Boolean(part.text?.trim()));
}

function extractCurrentMessageText(currentInput: Part[]): string {
  return extractTextParts(currentInput)
    .map((part) => part.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n');
}

/** 档案中是否有经用户上传验证的外形数据 */
export function profileHasVisualData(profile: UserProfileResult): boolean {
  return Boolean(
    profile.skin_tone.trim() ||
      profile.body_shape.trim() ||
      (profile.visual_features.hair_color &&
        profile.visual_features.hair_color !== 'unknown') ||
      (profile.visual_features.detected_features &&
        profile.visual_features.detected_features !== 'none')
  );
}

/** 本轮是否无需调用 Profile Agent（由 Gatekeeper 意图判定，非正则清洗） */
export function shouldSkipProfileAgentUpdate(
  intent: GatekeeperIntent | undefined,
  currentMessageText: string
): boolean {
  if (!intent) return false;

  if (
    intent.request_type === 'outfit_selection' ||
    intent.request_type === 'outfit_confirmed' ||
    intent.request_type === 'clarify'
  ) {
    return true;
  }

  if (intent.request_type === 'feedback_revision') {
    return true;
  }

  if (intent.request_type === 'wardrobe_pairing' && extractConfirmedWardrobeId(currentMessageText)) {
    return true;
  }

  return false;
}

export function profileFromDbRecord(dbProfile: Record<string, unknown>): UserProfileResult {
  const visual = readVerifiedVisualProfile(dbProfile);
  const preferences = Array.isArray(dbProfile.preferences)
    ? dbProfile.preferences.filter((p): p is string => typeof p === 'string')
    : [];

  return {
    name: typeof dbProfile.name === 'string' ? dbProfile.name : '',
    height: typeof dbProfile.height === 'string' ? dbProfile.height : '',
    weight: typeof dbProfile.weight === 'string' ? dbProfile.weight : '',
    preferences,
    personal_style:
      typeof dbProfile.personal_style === 'string' && dbProfile.personal_style.trim()
        ? dbProfile.personal_style
        : '日常休闲',
    ...visual,
  };
}

/** 跳过 LLM 时直接从 DB 加载档案（仍剥离未验证外形） */
export async function loadUserProfileFromDb(clientId: string): Promise<UserProfileResult> {
  const client = await prismadb.clientProfile.findUnique({ where: { id: clientId } });
  const dbProfile = (client?.profileData as Record<string, unknown>) || {};
  return profileFromDbRecord(dbProfile);
}

/** User Profile API 失败时的保底档案 */
export function buildUserProfileFallback(): UserProfileResult {
  return {
    name: '',
    height: '',
    weight: '',
    preferences: [],
    skin_tone: '',
    body_shape: '',
    personal_style: '日常休闲',
    visual_features: { hair_color: 'unknown', detected_features: 'none' },
  };
}

/**
 * 调用 User Profile Agent 生成/更新用户时尚档案。
 * 对话主路径已改为 Gate profile_update 异步 patch；本函数保留给需要全量 LLM 合并的场景。
 */
export async function callUserProfileAgent(
  history: Content[],
  currentInput: Part[],
  clientId?: string,
  auditContext?: UserProfileAuditContext
): Promise<UserProfileResult> {
  console.log('[USER_PROFILE_AGENT] Analyzing user profile from text...');

  let dbProfile: Record<string, unknown> = {};
  if (clientId) {
    try {
      const client = await prismadb.clientProfile.findUnique({ where: { id: clientId } });
      dbProfile = (client?.profileData as Record<string, unknown>) || {};
      console.log('[USER_PROFILE_AGENT] Successfully loaded existing profile from DB.');
    } catch (dbError) {
      console.warn('[USER_PROFILE_AGENT] Failed to load profile from DB, proceeding with empty profile:', dbError);
    }
  }

  const systemInstructionWithContext = `
${USER_PROFILE_SYSTEM_INSTRUCTION}

【用户已有的旧档案数据（作为合并基准）】
${JSON.stringify(dbProfile, null, 2)}
`;

  const textParts = extractTextParts(currentInput);
  const currentMessageText = extractCurrentMessageText(currentInput);
  const turnPrompt = `
【本轮用户输入 — 优先依据此项判断是否更新档案】
${currentMessageText || '（无文字）'}

若本轮仅为确认选衣橱/选方案/操作指令，所有字段原样返回旧档案，preferences 不得追加。
`;
  const messageParts: Part[] =
    textParts.length > 0
      ? [{ text: turnPrompt }, ...textParts]
      : [{ text: `${turnPrompt}\n（无文字输入，若无新档案信息则原样返回旧档案）` }];
  const contents: Content[] = [...history, { role: 'user', parts: messageParts }];

  try {
    const response = await withRetryOn429(
      () =>
        llmGenerate({
          model: AGENT_MODELS.userProfile,
          contents,
          systemInstruction: systemInstructionWithContext,
          temperature: 0.0,
          jsonSchema: userProfileSchema,
        }),
      { label: 'UserProfile' }
    );
    const responseText = response.text;

    if (!responseText) {
      throw new Error('Empty response from User Profile Agent');
    }

    console.log('[USER_PROFILE_AGENT] Raw response:', responseText);

    const parsed = JSON.parse(responseText) as UserProfileResult;
    const contextText = buildProfileContextText(history, currentInput);
    const withVisual = applyVerifiedVisualFields(parsed, dbProfile);
    const result = normalizePersonalStyle(withVisual, dbProfile);

    const l1 = evaluateUserProfileOutput({
      previousProfile: dbProfile,
      result,
      rawParsed: parsed,
      contextText,
      currentMessageText,
      skippedAgent: false,
    });

    const hadPreviousProfile = Object.keys(dbProfile).length > 0;
    void logUserProfileAudit({
      timestamp: new Date().toISOString(),
      conversationId: auditContext?.conversationId,
      messageId: auditContext?.messageId,
      userMessage: auditContext?.userMessage,
      contextTextLength: contextText.length,
      hadPreviousProfile,
      profile: result,
      previousProfileSnapshot: hadPreviousProfile ? snapshotPreviousProfile(dbProfile) : undefined,
      l1,
    });

    if (clientId) {
      console.log('[USER_PROFILE_AGENT] Triggering async DB persistence...');
      const profileToPersist = mergeChatProfileForPersistence(result, dbProfile);
      prismadb.clientProfile.upsert({
        where: { id: clientId },
        update: { profileData: profileToPersist as Prisma.InputJsonValue },
        create: { id: clientId, profileData: profileToPersist as Prisma.InputJsonValue },
      }).then(() => {
        console.log('[USER_PROFILE_AGENT] Successfully persisted profile to DB.');
      }).catch(e => {
        console.error('[USER_PROFILE_AGENT] Failed to persist profile to DB:', e);
      });
    }

    return result;
  } catch (error) {
    console.error('[USER_PROFILE_AGENT] Error calling User Profile Agent:', error);
    throw error;
  }
}
