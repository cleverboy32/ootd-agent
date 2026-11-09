import { Content, Part } from '@google/genai';
import { llmGenerate } from '@/server/services/llm/client';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { UserProfileResult, profileHasVisualData } from '../user-profile/agent';
import { performRagSearch } from '../rag/search';
import { filterSkillsForWardrobeSearch, selectStylistOutfitSkillNames } from './skillSelection';
import { selectStylistSkills } from './selectSkills';
import { WardrobeSearchQuery, WardrobeSearchSlot } from '@/server/utils/ragSearchSlots';
import { filterQueriesForRevisionSlots } from '@/server/utils/revisionSearchSlots';
import {
  alignStylistItemsWithWardrobe,
  normalizeOutfitGarmentLayers,
} from '@/server/utils/stylistItemAlign';
import {
  flattenOutfitPlanToQueries,
  type OutfitPlanResult,
} from '@/server/utils/outfitPlanSearch';
import { ClothingItem } from '@prisma/client';
import {
  AnchorItemInfo,
  AnchorSlot,
  GatekeeperIntent,
  getResolvedAnchorFromIntent,
  inferAnchorSlotFromSummary,
  isPurchasePairingIntent,
  isWardrobePairingIntent,
  listPurchaseAnchors,
  outfitIdToLabel,
} from '../intent';
import {
  clampStylistOutfits,
  stylistSchema,
  outfitPlanSearchSchema,
  styleAdviceSchema,
  StylistResult,
  StyleAdviceResult,
  StylistAgentOptions,
} from './schema';
import {
  STYLIST_SYSTEM_INSTRUCTION,
  OUTFIT_PLAN_SEARCH_INSTRUCTION,
  OUTFIT_RECONCILE_ADDENDUM,
  PURCHASE_PAIRING_SEARCH_ADDENDUM,
  WARDROBE_PAIRING_SEARCH_ADDENDUM,
  REVISION_SEARCH_ADDENDUM,
  STYLE_ADVICE_SYSTEM_INSTRUCTION,
} from './prompts';
import { buildAndLogStylistSelection } from '@/server/logging/stylist';
import type { StylistSelectionSlotSnapshot } from '@/server/logging/stylist';
import { logWardrobeQueryAudit } from '@/server/logging/wardrobeQuery';
import { buildSkillBlocks } from '@/server/skills/loadSkill';
import { scheduleWardrobeQueryCritic } from './queryCritic';
import { scheduleStylistOutfitCritic } from './outfitCritic';
import { applyWeatherQueryGuard } from './weatherQueryGuard';
import {
  buildNewItemDiversityBlock,
  collectRecentNewItemLabels,
  collectRecentOutfitFingerprints,
  collectRecentWardrobeIds,
} from './newItemDiversity';
import { urlToGenerativePart } from '@/server/utils/image';
import { stripHistoryImages } from '../gatekeeper/textInput';
import {
  UPLOAD_GARMENT_OUTFIT_ADDENDUM,
  decideUploadVision,
  identifyUploadGarments,
  rememberedUploadGarments,
  shouldInspectUploads,
} from './uploadVision';

export type { StylistOutfit, StylistResult, StyleAdviceResult, StylistAgentOptions } from './schema';

export type StylistTurn =
  | { type: 'outfits'; result: StylistResult; intent: GatekeeperIntent; ignoredUploadNote: string }
  | { type: 'text'; reply: string };

/**
 * 调用 Stylist Agent 生成结构化风格建议（advice 模式，不走 RAG）
 */
export async function callStylistAdvice(
  history: Content[],
  initialParts: Part[],
  intent: GatekeeperIntent,
  profile: UserProfileResult,
  signal?: AbortSignal
): Promise<StyleAdviceResult> {
  console.log('[STYLIST_AGENT] Generating style advice...');

  const hasVisualProfile = profileHasVisualData(profile);
  const userMessage = extractUserMessage(initialParts);

  const prompt = `
【今日用户时尚档案】
- 风格偏好: ${profile.preferences.join(', ') || '未提供'}
- 性别: ${profile.gender || '未知'}
- 肤色: ${profile.skin_tone || '未分析'}
- 个人风格: ${profile.personal_style || '未分析'}
- 适合的风格: ${profile.suited_style || '未判断'}
- 可靠外形数据: ${hasVisualProfile ? '有（可做个性化建议）' : '无'}

【用户咨询主题】
- 原始诉求: ${intent.special_requests || '用户咨询穿搭建议'}
- 风格偏好: ${intent.style_preference || '未提供'}
- 场合背景: ${intent.occasion || '未限定'}

【用户当前消息】
${userMessage || '（请根据历史对话推断咨询主题）'}

请针对用户的咨询主题，给出专业、实用的风格建议。
`;

  const contents: Content[] = [...stripHistoryImages(history), { role: 'user', parts: [{ text: prompt }] }];

  const response = await withRetryOn429(
    () =>
      llmGenerate({
        model: AGENT_MODELS.stylist,
        contents,
        systemInstruction: STYLE_ADVICE_SYSTEM_INSTRUCTION,
        temperature: 0.5,
        jsonSchema: styleAdviceSchema,
        signal,
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

function filterQueriesExcludingAnchorSlots(
  queries: WardrobeSearchQuery[],
  slots: Array<WardrobeSearchSlot | AnchorSlot | ''>
): WardrobeSearchQuery[] {
  const excluded = new Set<string>(slots.filter((slot): slot is WardrobeSearchSlot | AnchorSlot => Boolean(slot)));
  if (excluded.size === 0) return queries;
  return queries.filter((item) => !item.slot || !excluded.has(item.slot));
}

function anchorSlotToLayer(slot: WardrobeSearchSlot): string {
  const map: Record<WardrobeSearchSlot, string> = {
    top: 'top',
    bottom: 'bottom',
    dress: 'dress',
    shoes: 'shoes',
    outerwear: 'outerwear',
    accessory: 'accessory',
  };
  return map[slot] ?? 'top';
}

export type WardrobeSearchAuditContext = {
  conversationId?: string;
  messageId?: string;
};

export type OutfitPlanAndQueries = {
  plan: OutfitPlanResult;
  queries: WardrobeSearchQuery[];
};

export async function planOutfitsAndQueries(
  history: Content[],
  intent: GatekeeperIntent,
  profile: UserProfileResult,
  userMessage: string,
  anchorItem: AnchorItemInfo | null,
  signal?: AbortSignal,
  purchaseAnchors: AnchorItemInfo[] = [],
  skillNames: string[] = [],
  audit?: WardrobeSearchAuditContext,
  diversityBlock = ''
): Promise<OutfitPlanAndQueries> {
  console.log('[STYLIST_AGENT] Planning outfits + wardrobe search queries...');

  const anchors = purchaseAnchors.length > 0 ? purchaseAnchors : anchorItem ? [anchorItem] : [];
  const isPairing = (isPurchasePairingIntent(intent) || isWardrobePairingIntent(intent)) && anchors.length > 0;
  const isRevision = intent.request_type === 'feedback_revision';
  const searchSkillNames = filterSkillsForWardrobeSearch(skillNames);
  const skillBlock = buildSkillBlocks(searchSkillNames);
  const pairingBlock = isPairing
    ? `
【锚定单品】
${anchors
  .map(
    (item, index) =>
      `- ${index + 1}. 名称: ${item.name}；描述: ${item.summary}；槽位: ${
        intent.purchase_items?.[index]?.slot || inferAnchorSlotFromSummary(item.summary) || '按外观判断，先不要为它占一个检索槽位'
      }`
  )
  .join('\n')}
${isWardrobePairingIntent(intent) ? '- 来源: 用户衣橱已有单品（真实 id）' : '- 来源: 待购单品（new_item），以上每一件都要留在最终方案里'}

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

  const hasStyleSkill = searchSkillNames.some((name) => name.startsWith('style-'));
  const strategyHint = isRevision
    ? `- 当前为【反馈微调】：只为 special_requests 要改的槽位写 slots，未改槽位不要写入 plan。`
    : isPairing
      ? `- 当前为【待购/衣橱锚定搭配】：只为互补槽位写 slots。已占用的槽位不要写。${
          anchors.length === 1 && anchors[0].slot === 'accessory'
            ? '锚定为配饰：必须包含 top、bottom、shoes。'
            : ''
        }${hasStyleSkill ? '\n- 已注入风格技能：互补槽位的 search_query 必须遵循该技能「检索」节。' : ''}`
      : `- 若用户要「一套」：只出 outfit_1；覆盖上装+下装+鞋（视天气加外套），不要混裤装与连衣裙路线。
${
  hasStyleSkill
    ? '- 已注入风格技能：有天气细则时先跟层次与厚薄；各槽 search_query 必须带该技能风格词并写清形态；禁止万能词。'
    : '- 无风格技能时：query 可更宽，但仍写清品类轮廓；鞋不要无理由默认运动鞋。'
}
- 若场合需要点缀或用户提及配饰：加 accessory 槽。
- target 与 search_query 必须同向；多套时每套该槽可不同 query（分开检索）。`;

  const prompt = `
【今日用户时尚档案】
- 风格偏好: ${profile.preferences.join(', ') || '未提供'}
- 性别: ${profile.gender || '未知'}（影响款式与气质取舍；检索词按需带性别词）
- 肤色: ${profile.skin_tone || '未分析'}
- 身材: ${profile.body_shape || '未分析'}
- 个人风格: ${profile.personal_style || '未分析'}
- 适合的风格: ${profile.suited_style || '未判断'}（用户这轮没点名风格时，按这个风格来搭）

【今日穿搭意图】
- 请求类型: ${intent.request_type}
- 天气: ${intent.weather}
- 场合: ${intent.occasion}
- 风格: ${intent.style_preference}
- 特殊要求: ${intent.special_requests || '无'}
${skillBlock}${pairingBlock}${revisionBlock}
【用户当前消息】
${userMessage || '（无文字，请根据对话历史推断）'}
${diversityBlock}
【策略提示】
${strategyHint}

请输出 outfits 方案骨架（含每槽 target + search_query）：
`;

  const contents: Content[] = [...stripHistoryImages(history), { role: 'user', parts: [{ text: prompt }] }];

  let systemInstruction = OUTFIT_PLAN_SEARCH_INSTRUCTION;
  if (isRevision) {
    systemInstruction = `${OUTFIT_PLAN_SEARCH_INSTRUCTION}\n${REVISION_SEARCH_ADDENDUM}`;
  } else if (isPairing) {
    systemInstruction = `${OUTFIT_PLAN_SEARCH_INSTRUCTION}\n${
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
        jsonSchema: outfitPlanSearchSchema,
        signal,
      }),
    { label: 'Stylist outfit plan search' }
  );

  const responseText = response.text;
  if (!responseText) {
    throw new Error('Empty outfit plan response from Stylist Agent');
  }

  const plan = JSON.parse(responseText) as OutfitPlanResult;
  if (!Array.isArray(plan.outfits) || plan.outfits.length === 0) {
    throw new Error('Outfit plan missing outfits[]');
  }

  let queries = flattenOutfitPlanToQueries(plan);

  if (isPairing) {
    const slots =
      purchaseAnchors.length > 1
        ? (intent.purchase_items ?? []).map(
            (item) => item.slot || inferAnchorSlotFromSummary(item.summary)
          )
        : anchors.map((item) => item.slot);
    queries = filterQueriesExcludingAnchorSlots(queries, slots);
  }
  if (isRevision) {
    queries = filterQueriesForRevisionSlots(queries, intent.special_requests || userMessage);
  }

  const guarded = applyWeatherQueryGuard(queries, {
    weather: intent.weather || '',
    skillNames: searchSkillNames,
    userMessage,
    specialRequests: intent.special_requests,
  });
  queries = guarded.queries;

  console.log(
    '[STYLIST_AGENT] Outfit plan:',
    plan.outfits.map((o) => `${o.id}:${o.overall_concept}`).join(' | ')
  );
  console.log('[STYLIST_AGENT] Wardrobe search queries:', queries);

  void logWardrobeQueryAudit({
    timestamp: new Date().toISOString(),
    kind: 'queries',
    conversationId: audit?.conversationId,
    messageId: audit?.messageId,
    userMessage,
    occasion: intent.occasion,
    specialRequests: intent.special_requests,
    stylePreference: intent.style_preference,
    skillNames: searchSkillNames,
    queries: queries.map((item) => ({
      slot: item.slot,
      query: item.query,
      outfitId: item.outfitId,
      target: item.target,
    })),
    planOutfits: plan.outfits.map((o) => ({
      id: o.id,
      overall_concept: o.overall_concept,
      slots: (o.slots ?? []).map((s) => ({
        slot: String(s.slot),
        target: s.target,
        search_query: s.search_query,
        allow_new: s.allow_new !== false,
      })),
    })),
  }).catch((error) => {
    console.warn('[WARDROBE_QUERY] log failed:', error);
  });

  if (guarded.changes.length > 0) {
    void logWardrobeQueryAudit({
      timestamp: new Date().toISOString(),
      kind: 'weather_query_guard',
      conversationId: audit?.conversationId,
      messageId: audit?.messageId,
      userMessage,
      occasion: intent.occasion,
      specialRequests: intent.special_requests,
      stylePreference: intent.style_preference,
      skillNames: searchSkillNames,
      queries: queries.map((item) => ({
        slot: item.slot,
        query: item.query,
        outfitId: item.outfitId,
      })),
      changes: guarded.changes,
    }).catch((error) => {
      console.warn('[WARDROBE_QUERY_GUARD] log failed:', error);
    });
  }

  scheduleWardrobeQueryCritic({
    intent,
    userMessage,
    searchSkillNames,
    queries,
    conversationId: audit?.conversationId,
    messageId: audit?.messageId,
    signal,
  });

  return { plan, queries };
}

/** @deprecated 使用 planOutfitsAndQueries */
export async function planWardrobeSearchQueries(
  ...args: Parameters<typeof planOutfitsAndQueries>
): Promise<WardrobeSearchQuery[]> {
  const { queries } = await planOutfitsAndQueries(...args);
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

async function garmentPartsForIntent(
  intent: GatekeeperIntent,
  initialParts: Part[],
  imageUrls: string[]
): Promise<Part[]> {
  if (!isPurchasePairingIntent(intent)) return [];
  const cached = initialParts.filter((part) => part.inlineData?.data);
  const parts: Part[] = [];
  for (const item of listPurchaseAnchors(intent)) {
    const url = item.imageUrl?.trim();
    if (!url) continue;
    const index = imageUrls.indexOf(url);
    parts.push({ text: `上传单品参考，外观以这张图为准：${item.summary}` });
    const cachedPart = index >= 0 ? cached[index] : undefined;
    if (cachedPart) {
      parts.push(cachedPart);
      continue;
    }
    try {
      parts.push(await urlToGenerativePart(url));
    } catch (error) {
      console.warn('[STYLIST_AGENT] garment photo unavailable:', url.slice(0, 80), error);
    }
  }
  return parts;
}

/**
 * 搭配师先看本轮上传图，再检索、再选品。不是衣服且这句话离不开图时，只回文字。
 */
export async function callStylistTurn(
  history: Content[],
  intent: GatekeeperIntent,
  profile: UserProfileResult,
  initialParts: Part[],
  userId?: string,
  ragCache?: Map<string, ClothingItem>,
  conversationId?: string,
  options: StylistAgentOptions = {}
): Promise<StylistTurn> {
  let activeIntent = intent;
  let ignoredUploadNote = '';
  const imageUrls = (options.currentImageUrls ?? []).map((url) => url.trim()).filter(Boolean).slice(0, 4);
  const userMessage = extractUserMessage(initialParts);

  if (shouldInspectUploads(activeIntent.request_type, imageUrls.length)) {
    const remembered =
      activeIntent.request_type === 'outfit_redo'
        ? rememberedUploadGarments(options.priorStylistResults ?? [], imageUrls)
        : null;
    if (remembered) {
      console.log(
        '[STYLIST_AGENT] Reusing prior upload identities:',
        remembered.map((item) => item.identity).join(' | ')
      );
    }
    const seen = remembered
      ? { garments: remembered, textDependsOnImage: false }
      : await identifyUploadGarments(imageUrls, userMessage, options.signal, initialParts);
    const decision = decideUploadVision({
      intent: activeIntent,
      imageUrls,
      garments: seen.garments,
      textDependsOnImage: seen.textDependsOnImage,
      userMessage,
    });
    if (decision.type === 'reply') return { type: 'text', reply: decision.reply };
    activeIntent = decision.intent;
    ignoredUploadNote = decision.ignoredUploadNote;
  }

  const uploadGarmentParts = await garmentPartsForIntent(activeIntent, initialParts, imageUrls);
  const result = await callStylistAgent(
    history,
    activeIntent,
    profile,
    initialParts,
    userId,
    ragCache,
    conversationId,
    { ...options, uploadGarmentParts }
  );
  return { type: 'outfits', result, intent: activeIntent, ignoredUploadNote };
}

/**
 * 调用 Stylist Agent 生成穿搭方案
 */
export async function callStylistAgent(
  history: Content[],
  intent: GatekeeperIntent,
  profile: UserProfileResult,
  initialParts: Part[],
  userId?: string,
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

  const purchaseAnchors = isPurchasePairingIntent(intent) ? listPurchaseAnchors(intent) : [];
  const previousCache = options.previousStylistCache;
  const revisionOutfitId = intent.selected_outfit_id?.trim() || 'outfit_1';
  const previousOutfit =
    isRevision && previousCache
      ? previousCache.stylist_result.outfits.find((o) => o.id === revisionOutfitId) ??
        previousCache.stylist_result.outfits[0]
      : undefined;
  const recentNewItemLabels = collectRecentNewItemLabels(
    previousCache?.stylist_result.outfits,
    options.priorStylistResults
  );
  const recentFingerprints = collectRecentOutfitFingerprints(
    previousCache?.stylist_result.outfits,
    options.priorStylistResults
  );
  const recentWardrobeIds = collectRecentWardrobeIds(
    previousCache?.stylist_result.outfits,
    options.priorStylistResults
  );
  const newItemDiversityBlock = buildNewItemDiversityBlock(
    intent.request_type,
    recentNewItemLabels,
    { fingerprints: recentFingerprints, wardrobeIds: recentWardrobeIds }
  );
  if (newItemDiversityBlock) {
    console.log(
      `[STYLIST_AGENT] diversity fingerprints=${recentFingerprints.length} new_items=${recentNewItemLabels.length} wardrobe=${recentWardrobeIds.length}`
    );
  }

  let wardrobeXml = '';
  let ragIndexMap = new Map<string, string>();
  let slotSnapshots: StylistSelectionSlotSnapshot[] = [];
  let outfitPlan: OutfitPlanResult | null = null;
  const userMessage = extractUserMessage(initialParts);
  const skillNames = await selectStylistSkills(intent, userMessage, profile, {
    signal: options.signal,
    conversationId,
    messageId: options.messageId,
  });
  const skillBlock = buildSkillBlocks(skillNames);
  if (userId && ragCache) {
    try {
      console.log(
        `[STYLIST_AGENT] Plan→Retrieve${isRevision ? ' (revision slots)' : ''}...`
      );
      const planned = await planOutfitsAndQueries(
        history,
        intent,
        profile,
        userMessage,
        anchorItem,
        options.signal,
        purchaseAnchors,
        skillNames,
        { conversationId, messageId: options.messageId },
        newItemDiversityBlock
      );
      outfitPlan = planned.plan;
      const searchResults = await performRagSearch(planned.queries, userId, ragCache, {
        source: isRevision ? 'stylist-agent-revision' : 'stylist-agent',
        conversationId,
        userMessage,
        intent,
        anchorItem: anchorItem ?? undefined,
        skillNames,
      });
      wardrobeXml = searchResults.xmlString;
      ragIndexMap = searchResults.indexMap;
      slotSnapshots = searchResults.slotSnapshots;
    } catch (ragError) {
      console.warn('[STYLIST_AGENT] RAG search failed, proceeding with empty wardrobe:', ragError);
    }
  }

  const hasVisualProfile = profileHasVisualData(profile);
  const wardrobeAnchorId = isWardrobePairingIntent(intent) ? intent.anchor_wardrobe_id : undefined;
  const purchaseAnchorBlock =
    purchaseAnchors.length > 0
      ? `
【待购锚定单品 — 每套方案必须全部包含，每件 id 都是 "new_item"】
${purchaseAnchors
  .map((item, index) => {
    const known = intent.purchase_items?.[index]?.slot || inferAnchorSlotFromSummary(item.summary);
    return `- ${index + 1}. name: ${item.name}；layer: ${anchorSlotToLayer(known || item.slot)}；描述: ${item.summary}${
      known ? '' : '；槽位按外观判断'
    }`;
  })
  .join('\n')}
`
      : '';
  const anchorBlock =
    purchaseAnchorBlock ||
    (anchorItem != null
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
      : '');

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

  const planBlock =
    outfitPlan && outfitPlan.outfits.length > 0
      ? `
【方案骨架 Plan — 必须兑现】
${JSON.stringify(outfitPlan, null, 2)}
- 确认方案时套数与 id 对齐 Plan；new_item 须兑现对应槽 target/search_query 的品类主线与颜色方向。
`
      : '';

  const contextPrompt = `
【今日用户时尚档案】
- 姓名: ${profile.name || '未提供'}
- 身高: ${profile.height || '未提供'}
- 体重: ${profile.weight || '未提供'}
- 风格偏好: ${profile.preferences.join(', ') || '未提供'}
- 性别: ${profile.gender || '未知'}
- 肤色属性: ${profile.skin_tone || '未分析'}
- 身材属性: ${profile.body_shape || '未分析'}
- 个人风格定位: ${profile.personal_style || '未分析'}
- 适合的风格: ${profile.suited_style || '未判断'}（用户这轮没点名风格时，按这个风格来搭）
- 可靠外形数据: ${hasVisualProfile ? '有（肤色和身形用于选色和版型；适合的风格用于没点名风格时的造型。禁止把外形写进画面描述，禁止改人物外形）' : '无（禁止编造模特外形）'}

【今日穿搭意图】
- 请求类型: ${intent.request_type}
- 天气温度: ${intent.weather}
- 场合: ${intent.occasion}
- 风格偏好: ${intent.style_preference}
- 特殊要求: ${intent.special_requests || '无'}
${skillBlock}${planBlock}${anchorBlock}${revisionBlock}${newItemDiversityBlock}
【用户衣橱单品列表 (RAG 检索结果 — ${isRevision ? '本轮替换槽位候选' : '按 Plan 分槽召回'})】
${
  wardrobeXml ||
  (isRevision && previousCache
    ? '*(微调模式：本轮未召回新候选；未改动槽位复用上一轮衣橱单品 id；若必须换品且无候选则用 new_item，且须贴合 Plan)*'
    : '*(用户衣橱为空或未召回；按 Plan target 用 new_item 兑现)*')
}
`;

  const uploadGarmentParts = options.uploadGarmentParts ?? [];
  const seesGarments = uploadGarmentParts.some((part) => part.inlineData?.data);
  const contents: Content[] = [
    ...stripHistoryImages(history),
    { role: 'user', parts: [...uploadGarmentParts, { text: contextPrompt }] },
  ];

  try {
    const response = await withRetryOn429(
      () =>
        llmGenerate({
          model: seesGarments ? AGENT_MODELS.stylistVision : AGENT_MODELS.stylist,
          contents,
          systemInstruction: `${STYLIST_SYSTEM_INSTRUCTION}\n${OUTFIT_RECONCILE_ADDENDUM}${
            seesGarments ? UPLOAD_GARMENT_OUTFIT_ADDENDUM : ''
          }${buildSkillBlocks(selectStylistOutfitSkillNames(intent))}`,
          temperature: 0.4,
          jsonSchema: stylistSchema,
          signal: options.signal,
        }),
      { label: 'Stylist reconcile' }
    );
    const responseText = response.text;

    if (!responseText) {
      throw new Error('Empty response from Stylist Agent');
    }

    console.log('[STYLIST_AGENT] Raw response:', responseText);
    const parsed = JSON.parse(responseText) as StylistResult;
    parsed.outfits = clampStylistOutfits(parsed.outfits ?? []);
    resolveRagRefs(parsed, ragIndexMap);
    if (ragCache && ragCache.size > 0) {
      alignStylistItemsWithWardrobe(parsed, ragCache);
    } else {
      normalizeOutfitGarmentLayers(parsed);
    }
    buildAndLogStylistSelection({
      result: parsed,
      slotSnapshots,
      requestType: intent.request_type,
      conversationId,
      messageId: options.messageId,
      userMessage,
    });

    const anchorSummaryParts = [
      ...(anchorItem
        ? [`单锚点: ${anchorItem.name} (${anchorItem.slot || 'unknown'}) ${anchorItem.summary}`]
        : []),
      ...purchaseAnchors.map(
        (item, index) =>
          `待购${index + 1}: ${item.name} (${item.slot || 'unknown'}) ${item.summary}`
      ),
    ];
    scheduleStylistOutfitCritic({
      intent,
      userMessage,
      skillNames,
      result: parsed,
      anchorSummary: anchorSummaryParts.join('；') || undefined,
      conversationId,
      messageId: options.messageId,
      signal: options.signal,
    });

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
    const purchaseUrls = purchaseAnchors
      .map((item) => item.imageUrl?.trim() || '')
      .filter(Boolean);
    parsed.purchase_image_urls =
      purchaseUrls.length > 0
        ? purchaseUrls
        : previousCache?.stylist_result.purchase_image_urls;
    const rememberedGarments = (intent.purchase_items ?? [])
      .map((item) => ({
        imageUrl: item.imageUrl?.trim() ?? '',
        slot: item.slot,
        identity: item.summary.trim(),
      }))
      .filter((item) => item.imageUrl && item.slot && item.identity);
    if (rememberedGarments.length > 0) parsed.upload_garments = rememberedGarments;
    return parsed;
  } catch (error) {
    console.error('[STYLIST_AGENT] Error calling Stylist Agent:', error);
    throw error;
  }
}
