import { Content, Part } from '@google/genai';
import { llmGenerate } from '@/server/services/llm/client';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { UserProfileResult, profileHasVisualData } from '../user-profile/agent';
import { performRagSearch } from '../rag/search';
import { isAthleticOccasion } from '@/server/utils/ragMatchQuality';
import { WardrobeSearchQuery, parseWardrobeSearchSlot, WardrobeSearchSlot } from '@/server/utils/ragSearchSlots';
import { filterQueriesForRevisionSlots } from '@/server/utils/revisionSearchSlots';
import { alignStylistItemsWithWardrobe } from '@/server/utils/stylistItemAlign';
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
  REVISION_SEARCH_ADDENDUM,
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
      llmGenerate({
        model: AGENT_MODELS.stylist,
        contents,
        systemInstruction: STYLE_ADVICE_SYSTEM_INSTRUCTION,
        temperature: 0.5,
        jsonSchema: styleAdviceSchema,
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
  const isRevision = intent.request_type === 'feedback_revision';
  const athleticOccasion = isAthleticOccasion(intent, userMessage);
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

  const revisionBlock = isRevision
    ? `
【反馈微调 — 检索范围】
- 用户修改要求: ${intent.special_requests || '无'}
${REVISION_SEARCH_ADDENDUM}
`
    : '';

  const strategyHint = isRevision
    ? `- 当前为【反馈微调】：只为 special_requests 要改的槽位出 query，未改槽位不要搜。`
    : isPairing
      ? `- 当前为【待购单品搭配】：只为互补槽位检索衣橱单品，围绕锚定单品「${anchorItem.name}」找搭配。${
          anchorItem.slot === 'accessory'
            ? '锚定为配饰：必须输出 top、bottom、shoes 三条 query。'
            : ''
        }`
      : `- 若用户要「一套」穿搭：按槽位检索（上装 + 下装 + 鞋，视天气加外套），不要混搭裤装与连衣裙路线。
- 若场合需要点缀或用户提及配饰：额外加 1 条 accessory 槽位 query。
${athleticOccasion ? '- 当前为【运动场合】：检索 query 必须体现 athletic/sports 功能属性，下装搜 sports shorts，鞋搜 basketball/athletic sneakers。' : ''}`;

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
${pairingBlock}${revisionBlock}
【用户当前消息】
${userMessage || '（无文字，请根据对话历史推断）'}

【检索策略提示】
${strategyHint}

请输出衣橱检索 query 列表：
`;

  const contents: Content[] = [...history, { role: 'user', parts: [{ text: prompt }] }];

  let systemInstruction = WARDROBE_SEARCH_INSTRUCTION;
  if (isRevision) {
    systemInstruction = `${WARDROBE_SEARCH_INSTRUCTION}\n${REVISION_SEARCH_ADDENDUM}`;
  } else if (isPairing) {
    systemInstruction = `${WARDROBE_SEARCH_INSTRUCTION}\n${
      isWardrobePairingIntent(intent)
        ? WARDROBE_PAIRING_SEARCH_ADDENDUM
        : PURCHASE_PAIRING_SEARCH_ADDENDUM
    }`;
  }

  const response = await withRetryOn429(
    () =>
      llmGenerate({
        model: AGENT_MODELS.stylist,
        contents,
        systemInstruction,
        temperature: 0.3,
        jsonSchema: wardrobeSearchSchema,
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
  if (isRevision) {
    queries = filterQueriesForRevisionSlots(queries, intent.special_requests || userMessage);
  }

  console.log('[STYLIST_AGENT] Wardrobe search queries:', queries);
  return queries;
}

/**
 * 将 Stylist 输出中的 item_0/item_1 ref 还原为真实衣橱 ID。
 * 防止 LLM 在复制长 cuid 时发生字符幻觉。
 */
function resolveRagRefs(result: StylistResult, indexMap: Map<string, string>): void {
  if (indexMap.size === 0) return;
  for (const outfit of result.outfits) {
    for (const item of outfit.selected_items) {
      if (item.id === 'new_item') continue;
      const realId = indexMap.get(item.id);
      if (realId) {
        console.log(`[STYLIST_AGENT] ref resolved: ${item.id} → ${realId}`);
        item.id = realId;
      } else if (/^item_\d+$/.test(item.id)) {
        console.warn(`[STYLIST_AGENT] ref ${item.id} not in indexMap, falling back to new_item`);
        item.id = 'new_item';
      }
    }
  }
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
        imageUrl: resolvedAnchor.imageUrl,
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
  let ragIndexMap = new Map<string, string>();
  if (clientId && ragCache) {
    try {
      const userMessage = extractUserMessage(initialParts);
      console.log(
        `[STYLIST_AGENT] Triggering internal RAG search${isRevision ? ' (revision slots)' : ''}...`
      );
      const searchQueries = await planWardrobeSearchQueries(
        history,
        intent,
        profile,
        userMessage,
        anchorItem
      );
      const searchResults = await performRagSearch(searchQueries, clientId, ragCache, {
        source: isRevision ? 'stylist-agent-revision' : 'stylist-agent',
        conversationId,
        userMessage,
        intent,
        anchorItem: anchorItem ?? undefined,
      });
      wardrobeXml = searchResults.xmlString;
      ragIndexMap = searchResults.indexMap;
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
- 本轮 RAG XML 仅提供【要替换槽位】的候选；替换单品必须从 XML 选，name=subCategory；无匹配品类则用 new_item，禁止从其它套方案借不同品类单品。
`
      : isRevision
        ? `
【反馈微调模式】
- 目标方案 id: ${revisionOutfitId}
- 用户修改要求: ${intent.special_requests || '无'}
- 请结合历史对话中的上一轮方案进行精准修改，【只输出 1 套】
- 替换单品必须从本轮 RAG XML 选，name 等于 subCategory；无匹配则 new_item。
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
【用户衣橱单品列表 (RAG 检索结果 — ${isRevision ? '本轮替换槽位候选' : '互补单品'})】
${
  wardrobeXml ||
  (isRevision && previousCache
    ? '*(微调模式：本轮未召回新候选；未改动槽位复用上一轮衣橱单品 id；若必须换品且无候选则用 new_item)*'
    : '*(用户衣橱为空，请推荐全新单品)*')
}
${isAthleticOccasion(intent, extractUserMessage(initialParts)) ? '\n【提醒】当前为运动场合：请先阅读 <wardrobe_match_summary>，对 status=weak/none 的核心槽位使用 new_item，禁止硬选时装类单品。' : ''}
`;

  const contents: Content[] = [...history, { role: 'user', parts: [{ text: contextPrompt }] }];

  try {
    const response = await withRetryOn429(
      () =>
        llmGenerate({
          model: AGENT_MODELS.stylist,
          contents,
          systemInstruction: STYLIST_SYSTEM_INSTRUCTION,
          temperature: 0.4,
          jsonSchema: stylistSchema,
        }),
      { label: 'Stylist' }
    );
    const responseText = response.text;

    if (!responseText) {
      throw new Error('Empty response from Stylist Agent');
    }

    console.log('[STYLIST_AGENT] Raw response:', responseText);
    const parsed = JSON.parse(responseText) as StylistResult;
    resolveRagRefs(parsed, ragIndexMap);
    if (ragCache && ragCache.size > 0) {
      alignStylistItemsWithWardrobe(parsed, ragCache);
    }
    if (anchorItem?.imageData) {
      parsed.anchor_item_image_data = anchorItem.imageData;
    } else if (previousCache?.stylist_result.anchor_item_image_data?.data) {
      // feedback_revision 时 Gatekeeper 不再带图；从上一轮 stylist_cache 继承待购锚点图，
      // 否则 Seedream 只有衣橱参考、易把 new_item 下装画丢。
      parsed.anchor_item_image_data = previousCache.stylist_result.anchor_item_image_data;
      console.log('[STYLIST_AGENT] Inherited anchor_item_image_data from previous stylist cache');
    }
    const anchorUrl =
      anchorItem?.imageUrl?.trim() ||
      options.previousAnchorImageUrl?.trim() ||
      previousCache?.stylist_result.anchor_image_url?.trim() ||
      '';
    if (anchorUrl) {
      parsed.anchor_image_url = anchorUrl;
      console.log('[STYLIST_AGENT] anchor_image_url bound:', anchorUrl.slice(0, 80));
    }
    return parsed;
  } catch (error) {
    console.error('[STYLIST_AGENT] Error calling Stylist Agent:', error);
    throw error;
  }
}
