import { Content, Part } from '@google/genai';
import { genAI } from '@/server/services/ai';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { UserProfileResult, profileHasVisualData } from '../user-profile/agent';
import { performRagSearch } from '../rag/search';
import { WardrobeSearchQuery, parseWardrobeSearchSlot, WardrobeSearchSlot } from '@/server/utils/ragSearchSlots';
import { ClothingItem } from '@prisma/client';
import {
  AnchorItemInfo,
  AnchorSlot,
  GatekeeperIntent,
  getResolvedAnchorFromIntent,
  isPurchasePairingIntent,
  isWardrobePairingIntent,
  outfitIdToLabel,
} from '../intent';
import {
  stylistSchema,
  wardrobeSearchSchema,
  styleAdviceSchema,
  StylistResult,
  StyleAdviceResult,
  StylistAgentOptions,
} from './schema';
import {
  STYLIST_SYSTEM_INSTRUCTION,
  WARDROBE_SEARCH_INSTRUCTION,
  PURCHASE_PAIRING_SEARCH_ADDENDUM,
  WARDROBE_PAIRING_SEARCH_ADDENDUM,
  STYLE_ADVICE_SYSTEM_INSTRUCTION,
} from './prompts';

export type { StylistOutfit, StylistResult, StyleAdviceResult, StylistAgentOptions } from './schema';

/**
 * 调用 Stylist Agent 生成结构化风格建议（advice 模式，不走 RAG）
 */
export async function callStylistAdvice(
  history: Content[],
  initialParts: Part[],
  intent: GatekeeperIntent,
  profile: UserProfileResult
): Promise<StyleAdviceResult> {
  console.log('[STYLIST_AGENT] Generating style advice...');

  const hasVisualProfile = profileHasVisualData(profile);
  const userMessage = extractUserMessage(initialParts);

  const prompt = `
【今日用户时尚档案】
- 风格偏好: ${profile.preferences.join(', ') || '未提供'}
- 肤色: ${profile.skin_tone || '未分析'}
- 个人风格: ${profile.personal_style || '未分析'}
- 可靠外形数据: ${hasVisualProfile ? '有（可做个性化建议）' : '无'}

【用户咨询主题】
- 原始诉求: ${intent.special_requests || '用户咨询穿搭建议'}
- 风格偏好: ${intent.style_preference || '未提供'}
- 场合背景: ${intent.occasion || '未限定'}

【用户当前消息】
${userMessage || '（请根据历史对话推断咨询主题）'}

请针对用户的咨询主题，给出专业、实用的风格建议。
`;

  const contents: Content[] = [...history, { role: 'user', parts: [{ text: prompt }] }];

  const response = await withRetryOn429(
    () =>
      genAI.models.generateContent({
        model: AGENT_MODELS.stylist,
        contents,
        config: {
          systemInstruction: STYLE_ADVICE_SYSTEM_INSTRUCTION,
          temperature: 0.5,
          responseMimeType: 'application/json',
          responseSchema: styleAdviceSchema,
        },
      }),
    { label: 'Stylist advice' }
  );

  const responseText = response.text;
  if (!responseText) {
    throw new Error('Empty response from Stylist advice mode');
  }

  console.log('[STYLIST_AGENT] Advice raw response:', responseText);
  return JSON.parse(responseText) as StyleAdviceResult;
}

function extractUserMessage(initialParts: Part[]): string {
  const textPart = initialParts.find((part): part is { text: string } => 'text' in part);
  return textPart?.text?.trim() || '';
}

function filterQueriesExcludingAnchorSlot(
  queries: WardrobeSearchQuery[],
  anchorSlot?: WardrobeSearchSlot | AnchorSlot
): WardrobeSearchQuery[] {
  if (!anchorSlot) return queries;
  return queries.filter((item) => item.slot !== anchorSlot);
}

function anchorSlotToLayer(slot: WardrobeSearchSlot): string {
  const map: Record<WardrobeSearchSlot, string> = {
    top: 'inner_top',
    bottom: 'bottom',
    dress: 'dress',
    shoes: 'shoes',
    outerwear: 'outerwear',
    accessory: 'accessory',
  };
  return map[slot] ?? 'inner_top';
}

async function planWardrobeSearchQueries(
  history: Content[],
  intent: GatekeeperIntent,
  profile: UserProfileResult,
  userMessage: string,
  anchorItem: AnchorItemInfo | null
): Promise<WardrobeSearchQuery[]> {
  console.log('[STYLIST_AGENT] Planning wardrobe search queries...');

  const isPairing = (isPurchasePairingIntent(intent) || isWardrobePairingIntent(intent)) && anchorItem;
  const pairingBlock = isPairing
    ? `
【锚定单品】
- 名称: ${anchorItem.name}
- 描述: ${anchorItem.summary}
- 槽位: ${anchorItem.slot}（请勿为此槽位生成检索 query）
${isWardrobePairingIntent(intent) ? '- 来源: 用户衣橱已有单品（真实 id）' : '- 来源: 待购单品（new_item）'}

${isWardrobePairingIntent(intent) ? WARDROBE_PAIRING_SEARCH_ADDENDUM : PURCHASE_PAIRING_SEARCH_ADDENDUM}
`
    : '';

  const prompt = `
【今日用户时尚档案】
- 风格偏好: ${profile.preferences.join(', ') || '未提供'}
- 肤色: ${profile.skin_tone || '未分析'}
- 身材: ${profile.body_shape || '未分析'}
- 个人风格: ${profile.personal_style || '未分析'}

【今日穿搭意图】
- 请求类型: ${intent.request_type}
- 天气: ${intent.weather}
- 场合: ${intent.occasion}
- 风格: ${intent.style_preference}
- 特殊要求: ${intent.special_requests || '无'}
${pairingBlock}
【用户当前消息】
${userMessage || '（无文字，请根据对话历史推断）'}

【检索策略提示】
${
  isPairing
    ? `- 当前为【待购单品搭配】：只为互补槽位检索衣橱单品，围绕锚定单品「${anchorItem.name}」找搭配。${
        anchorItem.slot === 'accessory'
          ? '锚定为配饰：必须输出 top、bottom、shoes 三条 query。'
          : ''
      }`
    : `- 若用户要「一套」穿搭：按槽位检索（上装 + 下装 + 鞋，视天气加外套），不要混搭裤装与连衣裙路线。
- 若场合需要点缀或用户提及配饰：额外加 1 条 accessory 槽位 query。`
}

请输出衣橱检索 query 列表：
`;

  const contents: Content[] = [...history, { role: 'user', parts: [{ text: prompt }] }];

  const response = await withRetryOn429(
    () =>
      genAI.models.generateContent({
        model: AGENT_MODELS.stylist,
        contents,
        config: {
          systemInstruction: isPairing
            ? `${WARDROBE_SEARCH_INSTRUCTION}\n${
                isWardrobePairingIntent(intent)
                  ? WARDROBE_PAIRING_SEARCH_ADDENDUM
                  : PURCHASE_PAIRING_SEARCH_ADDENDUM
              }`
            : WARDROBE_SEARCH_INSTRUCTION,
          temperature: 0.3,
          responseMimeType: 'application/json',
          responseSchema: wardrobeSearchSchema,
        },
      }),
    { label: 'Stylist wardrobe search' }
  );

  const responseText = response.text;
  if (!responseText) {
    throw new Error('Empty wardrobe search response from Stylist Agent');
  }

  const parsed = JSON.parse(responseText) as {
    wardrobe_search_queries: Array<{ slot?: string; query?: string }>;
  };
  let queries: WardrobeSearchQuery[] = parsed.wardrobe_search_queries
    .map((item) => ({
      slot: parseWardrobeSearchSlot(item.slot),
      query: item.query?.trim() ?? '',
    }))
    .filter((item) => item.query.length > 0);

  if (isPairing && anchorItem) {
    queries = filterQueriesExcludingAnchorSlot(queries, anchorItem.slot);
  }

  console.log('[STYLIST_AGENT] Wardrobe search queries:', queries);
  return queries;
}

/**
 * 调用 Stylist Agent 生成穿搭方案
 */
export async function callStylistAgent(
  history: Content[],
  intent: GatekeeperIntent,
  profile: UserProfileResult,
  initialParts: Part[],
  clientId?: string,
  ragCache?: Map<string, ClothingItem>,
  conversationId?: string,
  options: StylistAgentOptions = {}
): Promise<StylistResult> {
  console.log('[STYLIST_AGENT] Generating styling recommendations...');

  const isRevision = intent.request_type === 'feedback_revision';
  const resolvedAnchor = getResolvedAnchorFromIntent(intent);
  const anchorItem: AnchorItemInfo | null = resolvedAnchor
    ? {
        name: resolvedAnchor.name,
        summary: resolvedAnchor.summary,
        slot: resolvedAnchor.slot,
        imageData: resolvedAnchor.imageData,
      }
    : null;

  if (isPurchasePairingIntent(intent) && !anchorItem) {
    throw new Error('PurchasePairingMissingAnchor: Gatekeeper 未提供有效的锚定单品，无法生成搭配方案');
  }
  if (isWardrobePairingIntent(intent) && !intent.anchor_wardrobe_id?.trim()) {
    throw new Error('WardrobePairingMissingAnchor: Gatekeeper 未确认衣橱锚定单品');
  }
  if (anchorItem) {
    console.log('[STYLIST_AGENT] Anchor item (from Gatekeeper):', anchorItem);
  }

  const previousCache = options.previousStylistCache;
  const revisionOutfitId = intent.selected_outfit_id?.trim() || 'outfit_1';
  const previousOutfit =
    isRevision && previousCache
      ? previousCache.stylist_result.outfits.find((o) => o.id === revisionOutfitId) ??
        previousCache.stylist_result.outfits[0]
      : undefined;

  let wardrobeXml = '';
  if (clientId && ragCache && !isRevision) {
    try {
      const userMessage = extractUserMessage(initialParts);
      console.log('[STYLIST_AGENT] Triggering internal RAG search...');
      const searchQueries = await planWardrobeSearchQueries(
        history,
        intent,
        profile,
        userMessage,
        anchorItem
      );
      const searchResults = await performRagSearch(searchQueries, clientId, ragCache, {
        source: 'stylist-agent',
        conversationId,
        userMessage,
        intent,
        anchorItem: anchorItem ?? undefined,
      });
      wardrobeXml = searchResults.xmlString;
    } catch (ragError) {
      console.warn('[STYLIST_AGENT] RAG search failed, proceeding with empty wardrobe:', ragError);
    }
  }

  const hasVisualProfile = profileHasVisualData(profile);
  const wardrobeAnchorId = isWardrobePairingIntent(intent) ? intent.anchor_wardrobe_id : undefined;
  const anchorBlock =
    anchorItem != null
      ? isWardrobePairingIntent(intent) && wardrobeAnchorId
        ? `
【衣橱锚定单品 — 每套方案必须包含】
- id: ${wardrobeAnchorId}（衣橱真实 id，禁止改为 new_item）
- name: ${anchorItem.name}
- layer: ${anchorSlotToLayer(anchorItem.slot)}
- 描述: ${anchorItem.summary}
`
        : `
【待购锚定单品 — 每套方案必须包含】
- id: "new_item"（固定）
- name: ${anchorItem.name}
- layer: ${anchorSlotToLayer(anchorItem.slot)}
- 描述: ${anchorItem.summary}
`
      : '';

  const revisionBlock =
    isRevision && previousOutfit
      ? `
【反馈微调模式 — 必须遵守】
- 目标方案 id: ${revisionOutfitId}（${outfitIdToLabel(revisionOutfitId)}）
- 用户修改要求: ${intent.special_requests || '无'}
- 上一轮方案 JSON（在此基础上修改，未提及单品 id 保持不变）:
${JSON.stringify(previousOutfit, null, 2)}
- 【只输出 1 套】，id 必须为 ${revisionOutfitId}
`
      : isRevision
        ? `
【反馈微调模式】
- 目标方案 id: ${revisionOutfitId}
- 用户修改要求: ${intent.special_requests || '无'}
- 请结合历史对话中的上一轮方案进行精准修改，【只输出 1 套】
`
        : '';

  const contextPrompt = `
【今日用户时尚档案】
- 姓名: ${profile.name || '未提供'}
- 身高: ${profile.height || '未提供'}
- 体重: ${profile.weight || '未提供'}
- 风格偏好: ${profile.preferences.join(', ') || '未提供'}
- 肤色属性: ${profile.skin_tone || '未分析'}
- 身材属性: ${profile.body_shape || '未分析'}
- 个人风格定位: ${profile.personal_style || '未分析'}
- 视觉特征: 发色为 ${profile.visual_features.hair_color}，其他特征: ${profile.visual_features.detected_features}
- 可靠外形数据: ${hasVisualProfile ? '有（可结合肤色身材绘图）' : '无（禁止编造模特外形）'}

【今日穿搭意图】
- 请求类型: ${intent.request_type}
- 天气温度: ${intent.weather}
- 场合: ${intent.occasion}
- 风格偏好: ${intent.style_preference}
- 特殊要求: ${intent.special_requests || '无'}
${anchorBlock}${revisionBlock}
【用户衣橱单品列表 (RAG 检索结果 — 互补单品)】
${wardrobeXml || (isRevision && previousCache ? '*(微调模式：优先复用上一轮方案中的衣橱单品 id)*' : '*(用户衣橱为空，请推荐全新单品)*')}
`;

  const chat = genAI.chats.create({
    model: AGENT_MODELS.stylist,
    history: history.length > 0 ? history : undefined,
    config: {
      systemInstruction: STYLIST_SYSTEM_INSTRUCTION,
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: stylistSchema,
    },
  });

  try {
    const response = await withRetryOn429(
      () => chat.sendMessage({ message: contextPrompt }),
      { label: 'Stylist' }
    );
    const responseText = response.text;

    if (!responseText) {
      throw new Error('Empty response from Stylist Agent');
    }

    console.log('[STYLIST_AGENT] Raw response:', responseText);
    const parsed = JSON.parse(responseText) as StylistResult;
    if (anchorItem?.imageData) {
      parsed.anchor_item_image_data = anchorItem.imageData;
    }
    return parsed;
  } catch (error) {
    console.error('[STYLIST_AGENT] Error calling Stylist Agent:', error);
    throw error;
  }
}
