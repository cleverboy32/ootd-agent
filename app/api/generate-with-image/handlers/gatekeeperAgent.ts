import { Content, Part, Type, Schema } from '@google/genai';
import { genAI } from '@/server/services/ai';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import {
  GatekeeperIntent,
  enrichIntentFromContext,
  extractTextFromParts,
  extractUserTextFromHistory,
  collectImageParts,
  detectRequestTypeFromText,
  inferOccasionFromText,
  buildPurchasePairingSpecialRequest,
  collectLatestImageData,
  normalizeGatekeeperIntent,
  finalizeGatekeeperResult,
} from './intentTypes';

const gatekeeperSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    is_complete: {
      type: Type.BOOLEAN,
      description:
        '信息是否齐全。wardrobe_outfit 需场合明确；purchase_pairing 需能识别锚定单品且场合可默认日常百搭；feedback_revision 直接放行。',
    },
    extracted_intent: {
      type: Type.OBJECT,
      properties: {
        weather: {
          type: Type.STRING,
          description: '用户主动提到的天气或温度信息（如：15度、下雨）。若用户未提及，填空字符串。',
        },
        occasion: {
          type: Type.STRING,
          description: '穿搭场合。若信息不全，此项填空字符串。',
        },
        style_preference: {
          type: Type.STRING,
          description:
            '用户原文中明确说出的风格偏好（如：温柔风、美式复古、松弛感）。禁止根据场合臆测风格。用户未提及则填 "日常休闲"。',
        },
        special_requests: {
          type: Type.STRING,
          description:
            '用户明确说出的特殊要求（遮肚子、显腿长等）；purchase_pairing 时填写待购单品搭配说明。禁止臆测身材修饰需求。',
        },
        request_type: {
          type: Type.STRING,
          description:
            '请求类型：wardrobe_outfit（从衣橱搭一套）| purchase_pairing（待购/上传单品+衣橱互补）| feedback_revision（修改上一轮方案）',
        },
        anchor_item_summary: {
          type: Type.STRING,
          description:
            'purchase_pairing 时：从用户上传服装图或文字提取的待购/待搭单品描述（颜色+品类+关键特征）。其他类型填空字符串。',
        },
        anchor_slot: {
          type: Type.STRING,
          description:
            'purchase_pairing 时锚定单品的穿搭槽位：top | bottom | dress | shoes | outerwear | accessory。耳环、项链、手链、戒指、包、腰带、围巾、帽子等必须填 accessory，禁止填 top。',
        },
      },
      required: [
        'weather',
        'occasion',
        'style_preference',
        'special_requests',
        'request_type',
        'anchor_item_summary',
        'anchor_slot',
      ],
    },
    followup_questions: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
      },
      description: '当 is_complete 为 false 时，用于追问用户的问题列表。当 is_complete 为 true 时，必须为空数组。',
    },
  },
  required: ['is_complete', 'extracted_intent', 'followup_questions'],
};

const GATEKEEPER_SYSTEM_INSTRUCTION = `
你是一个严格、专业且亲切的时尚前台把关人 (Gatekeeper Agent)。
你的唯一任务是评估用户当前的穿搭请求是否具备足够的信息来进行专业搭配。

【请求类型 request_type】
必须先判断用户属于哪一种：
1. wardrobe_outfit：用户要从【已有衣橱】搭配一套穿搭（无特定待购锚定单品）。
2. purchase_pairing：用户上传了服装单品图，或明确说「想买/打算买/这件能搭吗/用衣橱搭配这件」——核心是用【待购/待搭单品】作锚点，从衣橱找互补单品。
3. feedback_revision：用户在修改上一轮已给出的方案（如「第一套太正式了」「换成裤装」）——直接放行。

【purchase_pairing 放行标准（重要）】
- 你具备多模态能力，必须亲自从【历史对话中的服装图片】或【用户文字】识别锚定单品，填入 anchor_item_summary 和 anchor_slot。
- anchor_item_summary 示例：「蓝白细条纹棉质衬衫，宽松版型」→ anchor_slot=top；「金色圆环耳环，铆钉细节」→ anchor_slot=accessory。
- anchor_slot 必须是 top | bottom | dress | shoes | outerwear | accessory 之一。
- 【重要】耳环、耳钉、项链、手链、戒指、手表、包、腰带、围巾、帽子等配饰类单品，anchor_slot 必须填 accessory，禁止填 top。
- 场合要求放宽：用户说「平时/百搭/日常/都可以穿」即视为场合足够，occasion 填「日常百搭」。
- 只有完全无法从图片或文字识别锚定单品时，才 is_complete=false 并追问。
- special_requests 填：用户待购单品（xxx）需作为搭配锚点，从衣橱选取互补单品与之搭配。
- 不要因为缺少天气拦截 purchase_pairing。

【wardrobe_outfit 放行标准】
- 必须包含明确的场合（上班、约会、徒步等）。
- 场合不明确时 is_complete=false，亲切追问 1-2 个问题。

【feedback_revision】
- is_complete=true，request_type=feedback_revision，从上下文继承场合。

【不检查天气】
- 不要因缺少天气或温度信息而拦截用户。
- 若用户主动提到天气/温度，提取到 extracted_intent.weather；未提及则留空。

【严格提取，禁止臆测】
- style_preference：仅当用户明确提到风格词时填写；否则填 "日常休闲"。
- weather：仅提取用户主动提到的天气/温度；未提及则填 ""。
- anchor_item_summary / anchor_slot：仅 purchase_pairing 时填写；识别服装图时请描述颜色、品类、材质，不要描述模特外貌。

【工作流程】
1. 仔细阅读用户当前输入及历史对话（含历史中的服装图片）。
2. 判定 request_type。
3. 按对应放行标准决定 is_complete，并填充 extracted_intent。
`;

export interface GatekeeperResult {
  is_complete: boolean;
  extracted_intent: GatekeeperIntent;
  followup_questions: string[];
}

/** 429 或 API 失败时的保底 intent：结合历史上下文做极简提取 */
export function buildGatekeeperFallbackIntent(
  currentInput: Part[],
  history: Content[] = []
): GatekeeperIntent {
  const contextText = `${extractUserTextFromHistory(history)}\n${extractTextFromParts(currentInput)}`.trim();
  const requestType = detectRequestTypeFromText(contextText);
  const hasClothingImage = collectImageParts(history, currentInput).length > 0;
  const isPurchasePairing =
    requestType === 'purchase_pairing' || (hasClothingImage && /搭|配|买|这件/.test(contextText));

  let occasion = inferOccasionFromText(contextText);
  let specialRequests = '';

  if (isPurchasePairing) {
    if (!occasion) occasion = '日常百搭';
    specialRequests = buildPurchasePairingSpecialRequest('');
    return {
      weather: '',
      occasion,
      style_preference: '日常休闲',
      special_requests: specialRequests,
      request_type: 'purchase_pairing',
      anchor_item_summary: '',
      anchor_slot: '',
      anchor_item_image_data: collectLatestImageData(history, currentInput),
    };
  }

  return {
    weather: '',
    occasion,
    style_preference: '日常休闲',
    special_requests: specialRequests,
    request_type: requestType === 'feedback_revision' ? 'feedback_revision' : 'wardrobe_outfit',
    anchor_item_summary: '',
    anchor_slot: '',
  };
}

/** Gatekeeper 不可用时的保底放行结果 */
export function buildGatekeeperFallback(currentInput: Part[], history: Content[] = []): GatekeeperResult {
  const intent = buildGatekeeperFallbackIntent(currentInput, history);
  return finalizeGatekeeperResult({ extracted_intent: intent });
}

/**
 * 调用 Gatekeeper Agent 评估用户请求
 */
export async function callGatekeeperAgent(
  history: Content[],
  currentInput: Part[]
): Promise<GatekeeperResult> {
  console.log('[GATEKEEPER_AGENT] Evaluating user request...');

  const contents: Content[] = [...history, { role: 'user', parts: currentInput }];

  try {
    const response = await withRetryOn429(
      () =>
        genAI.models.generateContent({
          model: AGENT_MODELS.gatekeeper,
          contents,
          config: {
            systemInstruction: GATEKEEPER_SYSTEM_INSTRUCTION,
            temperature: 0.0,
            responseMimeType: 'application/json',
            responseSchema: gatekeeperSchema,
          },
        }),
      { label: 'Gatekeeper', maxRetries: 4 }
    );

    const responseText = response.text;
    if (!responseText) {
      throw new Error('Empty response from Gatekeeper Agent');
    }

    console.log('[GATEKEEPER_AGENT] Raw response:', responseText);
    const parsed = JSON.parse(responseText) as GatekeeperResult;
    const enrichedIntent = enrichIntentFromContext(
      normalizeGatekeeperIntent(parsed.extracted_intent),
      history,
      currentInput
    );

    return finalizeGatekeeperResult({
      extracted_intent: enrichedIntent,
      followup_questions: parsed.followup_questions,
    });
  } catch (error) {
    console.error('[GATEKEEPER_AGENT] Error calling Gatekeeper Agent:', error);
    throw error;
  }
}
