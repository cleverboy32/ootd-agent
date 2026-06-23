import { Content, Part, Type, Schema } from '@google/genai';
import { genAI } from '@/server/services/ai';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { evaluateUserProfileOutput } from '@/server/utils/userProfileEvaluator';
import { logUserProfileAudit } from '@/server/services/userProfileAuditLogger';
import {
  applyVerifiedVisualFields,
  isVisualProfileVerified,
  readVerifiedVisualProfile,
} from '@/server/utils/userProfileVisual';
import { mergeChatProfileForPersistence } from '@/server/utils/profileMetadata';
import {
  extractConfirmedWardrobeId,
  type GatekeeperIntent,
} from '@/app/api/generate-with-image/handlers/intentTypes';
import prismadb from 'server/db';
import { Prisma } from '@prisma/client';

// 定义 User Profile Agent 的输出 Schema
const userProfileSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    name: {
      type: Type.STRING,
      description:
        '用户姓名或昵称。仅当用户明确自我介绍（我叫/叫我/昵称是）时填写；称呼助手的「大哥」「亲」等不是姓名。未知且旧档案也没有则填空字符串。',
    },
    height: {
      type: Type.STRING,
      description: '用户身高（如 168cm）。若未知且旧档案中也没有，填空字符串。'
    },
    weight: {
      type: Type.STRING,
      description: '用户体重（如 52kg）。若未知且旧档案中也没有，填空字符串。'
    },
    preferences: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        '长期风格偏好（如喜欢极简、偏爱金色饰品、不爱穿外套）。禁止写入单次搭配请求、场合、或「想穿/想搭配某单品」等临时意图。确认选方案、点选衣橱单品时不要新增偏好。',
    },
    skin_tone: {
      type: Type.STRING,
      description: '仅保留旧档案中已有值；本次不从对话推断，无旧档案则填空字符串。'
    },
    body_shape: {
      type: Type.STRING,
      description: '仅保留旧档案中已有值；本次不从对话推断，无旧档案则填空字符串。'
    },
    personal_style: {
      type: Type.STRING,
      description:
        '用户明确说出的风格定位，或旧档案中已有值。用户未提及且无旧档案时填 "日常休闲"。禁止根据场合臆测（如上班≠知性风）。',
    },
    visual_features: {
      type: Type.OBJECT,
      properties: {
        hair_color: {
          type: Type.STRING,
          description: '仅保留旧档案中已有值；无旧档案则填 \'unknown\''
        },
        detected_features: {
          type: Type.STRING,
          description: '仅保留旧档案中已有值；无旧档案则填 \'none\''
        }
      },
      required: ['hair_color', 'detected_features']
    }
  },
  required: ['name', 'height', 'weight', 'preferences', 'skin_tone', 'body_shape', 'personal_style', 'visual_features']
};

const USER_PROFILE_SYSTEM_INSTRUCTION = `
你是一个世界顶级的时尚档案管理员 (User Profile Agent)。
你的任务：根据【本轮用户输入】与旧档案，更新结构化用户时尚档案。

【核心原则：档案 vs 搭配任务】
用户来搭配时说的「场合、想穿的单品、选第几套、确认衣橱 id」属于【本轮搭配任务】，不是用户长期档案。
你只记录【跨多次对话仍然成立】的稳定信息：身高体重、明确自我介绍、长期风格偏好。

【重要：不处理图片 / 不做外形分析】
- 对话中的衣物图不是用户自拍，禁止推断肤色、身材、发型、五官。
- skin_tone、body_shape、visual_features 必须原样复制旧档案；旧档案为空则 skin_tone/body_shape 填空，visual_features 填 unknown/none。
- 即使用户从未上传过自拍，也禁止从文字猜测外形。

【name — 仅明确自我介绍】
只有用户清楚表明身份时才填 name（我叫/叫我/昵称是/我的名字是）。
称呼助手的语气词不是姓名。

反例（name 必须保持旧档案或空）：
- 「大哥，是灰色外套」→ 大哥是称呼，不是名字
- 「亲，帮我搭一套」→ 不是名字

正例：
- 「我叫小明」→ name=小明

【preferences — 仅长期风格偏好，禁止场合与单次意图】
preferences 记录用户【一贯】的穿衣倾向，每条应能回答「这个人平时一贯喜欢什么」。

✅ 可写入：
- 「喜欢休闲舒适简约」
- 「平时不爱穿外套」
- 「偏爱金色饰品」
- 「偏好温柔知性同色系」

❌ 禁止写入（即使用户在历史里说过，也不要追加进 preferences）：
- 场合：上班通勤、日常逛街、和朋友吃饭、周末徒步、去滑雪、海边拍照
- 单次搭配请求：想穿绿色裙子、想搭配高跟鞋、想搭配灰色外套、想把包换成小皮包
- 操作确认：确认选择这件单品、选第一套、就这套

若本轮用户输入仅为确认选衣橱/选方案/无新档案信息 → preferences 必须与旧档案完全一致，禁止追加。

【personal_style】
仅用户明确说出风格定位时更新；否则保留旧档案；都没有填「日常休闲」。禁止根据场合臆测。

【智能合并】
- 本轮未提及的字段：保留旧档案，禁止清空。
- 本轮明确更新的字段：覆盖旧值。
- 不要把历史对话里出现过的每个场景都扫进 preferences。

【安全与尊重】
分析客观专业，禁止贬低或不适词汇。
`;

export interface UserProfileResult {
  name: string;
  height: string;
  weight: string;
  preferences: string[];
  skin_tone: string;
  body_shape: string;
  personal_style: string;
  visual_features: {
    hair_color: string;
    detected_features: string;
  };
}

export interface UserProfileAuditContext {
  conversationId?: string;
  messageId?: string;
  userMessage?: string;
}

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
 * 调用 User Profile Agent 生成/更新用户时尚档案
 * @param history 历史会话上下文
 * @param currentInput 用户当前输入（仅使用其中的文字，忽略图片）
 * @param clientId 可选的用户 ID，用于在内部自动查询旧档案并进行异步持久化写入
 * @param auditContext 可选审计上下文，用于 L1 评估与 logs/user-profile-audit.jsonl
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

  const chat = genAI.chats.create({
    model: AGENT_MODELS.userProfile,
    history: history.length > 0 ? history : undefined,
    config: {
      systemInstruction: systemInstructionWithContext,
      temperature: 0.0,
      responseMimeType: 'application/json',
      responseSchema: userProfileSchema,
    },
  });

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

  try {
    const response = await withRetryOn429(
      () => chat.sendMessage({ message: messageParts }),
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
        create: { id: clientId, profileData: profileToPersist as Prisma.InputJsonValue }
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
