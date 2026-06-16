import { Content, Part, Type, Schema } from '@google/genai';
import { genAI } from '@/server/services/ai';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import prismadb from 'server/db';

// 定义 User Profile Agent 的输出 Schema
const userProfileSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    name: {
      type: Type.STRING,
      description: '用户姓名或昵称。若未知且旧档案中也没有，填空字符串。'
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
      description: '用户的风格偏好列表。若未知且旧档案中也没有，填空数组。'
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
你是一个世界顶级的时尚量体师与全能时尚档案管理员 (User Profile Agent)。
你的任务是根据用户已有的旧档案数据、以及用户当前输入的【文字】与历史对话，更新结构化“今日用户时尚档案”。

【重要：不处理图片】
- 对话中可能附带衣物图片，那些不是用户自拍，禁止根据任何图片推断用户外形。
- 你不做视觉分析。skin_tone、body_shape、visual_features 仅原样保留旧档案中的值；旧档案为空则留空 / unknown / none。

【文本信息提取指南】
请仔细阅读用户当前的输入和历史对话，提取并更新以下字段：
- name: 用户的姓名或昵称。
- height: 用户的身高（如 168cm）。
- weight: 用户的体重（如 52kg）。
- preferences: 用户的风格偏好数组（如 ["极简风", "法式复古"]）。
- personal_style: 仅当用户明确说出风格词时填写；否则保留旧档案；都没有则填 "日常休闲"。禁止根据场合臆测气质标签。

【智能合并与保留规则】
- 系统会为你提供用户已有的旧档案数据（JSON 格式）。
- 如果用户这次没有提到某个字段，且旧档案中已有这些数据，你【必须】保留旧档案中的数据，绝对不能丢失或清空。
- 如果用户提到了新的数据（例如：“我最近瘦了，现在50kg”），你【必须】用新数据覆盖旧档案中的对应字段。

【安全与尊重原则】
- 你的分析必须客观、专业、充满赞美与时尚建设性。
- 严禁使用任何贬低、敏感或令人不适的词汇，必须转化为时尚术语。
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

function extractTextParts(parts: Part[]): Part[] {
  return parts.filter((part): part is { text: string } => 'text' in part && Boolean(part.text?.trim()));
}

function readStoredVisualProfile(dbProfile: Record<string, unknown>): Pick<
  UserProfileResult,
  'skin_tone' | 'body_shape' | 'visual_features'
> {
  const visual = dbProfile.visual_features as UserProfileResult['visual_features'] | undefined;
  return {
    skin_tone: typeof dbProfile.skin_tone === 'string' ? dbProfile.skin_tone : '',
    body_shape: typeof dbProfile.body_shape === 'string' ? dbProfile.body_shape : '',
    visual_features: {
      hair_color: visual?.hair_color || 'unknown',
      detected_features: visual?.detected_features || 'none',
    },
  };
}

/** 档案中是否有可用于搭配/绘图的外形数据（来自用户档案功能，非对话推断） */
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

/** 视觉字段仅来自 DB 旧档案，剥离模型从对话中的任何外形臆测 */
function applyStoredVisualFields(
  result: UserProfileResult,
  dbProfile: Record<string, unknown>
): UserProfileResult {
  const storedVisual = readStoredVisualProfile(dbProfile);
  return {
    ...result,
    skin_tone: storedVisual.skin_tone,
    body_shape: storedVisual.body_shape,
    visual_features: storedVisual.visual_features,
  };
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
 */
export async function callUserProfileAgent(
  history: Content[],
  currentInput: Part[],
  clientId?: string
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
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: userProfileSchema,
    },
  });

  const textParts = extractTextParts(currentInput);
  const messageParts: Part[] =
    textParts.length > 0 ? textParts : [{ text: '（无文字输入，请根据对话历史与旧档案更新）' }];

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
    const result = applyStoredVisualFields(parsed, dbProfile);

    if (clientId) {
      console.log('[USER_PROFILE_AGENT] Triggering async DB persistence...');
      prismadb.clientProfile.upsert({
        where: { id: clientId },
        update: { profileData: result as object },
        create: { id: clientId, profileData: result as object }
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
