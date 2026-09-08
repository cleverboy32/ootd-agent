import { Content } from '@google/genai';
import {
  GatekeeperIntent,
  GatekeeperFinalizeResult,
  FinalizeGatekeeperInput,
  OutfitRequestType,
  WardrobeResolverResult,
  WardrobeAnchorCandidate,
} from './typeDefs';
import {
  normalizeGatekeeperIntent,
  outfitIdToLabel,
  extractOutfitIdFromText,
  inferSelectedOutfitIdFromHistory,
  historyShowsMultipleOutfits,
  isPurchasePairingAnchorReady,
  isWardrobePairingAnchorReady,
  isWardrobeBrowseIntent,
} from './utils';

// ─── Reply builders ────────────────────────────────────────────────────────────

export function buildOutfitSelectionGatekeeperReply(outfitLabel: string): string {
  return `好的，${outfitLabel}～这套可以直接穿出门，还是想在鞋子、外套或配饰上微调一下？`;
}

export function buildOutfitConfirmedGatekeeperReply(outfitLabel: string): string {
  return `太好了！${outfitLabel}就定下来啦～祝您穿出好心情，有需要随时再来找我～`;
}

export function buildFeedbackRevisionOutfitClarifyReply(): string {
  return '好的～上一轮给您准备了多套方案，请问您想微调第一套还是第二套？';
}

export function buildWardrobeAmbiguousReply(): string {
  return '我在您的衣橱里找到了几件相似的单品，请点击确认您想穿的是哪一件～';
}

// ─── Static copy strings ───────────────────────────────────────────────────────

export const CLARIFY_INTENT_FOLLOWUP =
  '想确认一下您的需求～您是想让我从衣橱里搭一套穿搭，还是有某件单品想搭配，或者要在上一套方案上做调整呢？';

export const STYLE_ADVICE_FALLBACK_REPLY = '这个问题可以直接聊方法，不需要先限定场合。';

export const WARDROBE_NOT_FOUND_REPLY =
  '没在衣橱里找到匹配的单品～可以描述得更具体一些（颜色、款式），或者发一张该单品的照片给我～';

export function buildColorMismatchReply(
  queriedSummary: string,
  nearMiss: WardrobeAnchorCandidate
): string {
  const colorLabel = nearMiss.colors.length > 0 ? nearMiss.colors.join('、') : '其他颜色';
  return `衣橱里没有找到符合「${queriedSummary}」的单品。不过有一件${colorLabel}的${nearMiss.subCategory}，你看看是不是这件？`;
}

export function buildWardrobeBrowseReply(itemCount: number): string {
  if (itemCount <= 1) {
    return '在衣橱里找到了这件，点选确认后我可以帮你搭配～';
  }
  return '在衣橱里找到了几件相似的单品，请点击确认你想穿的是哪一件～';
}

/** LLM 在天气 enrich 之前写了「没查到温度」时，用已拉到的实况覆盖。 */
export function buildWeatherAwareClarifyReply(
  modelReply: string,
  weather: string,
  currentMessageText: string
): string {
  const asksTemperature = /温度|多少度|几度|冷|热|外套|穿衣|暖和|凉快/.test(currentMessageText);
  const modelClaimsNoWeather = /没拿到|暂时没有|无法|没有.*温度|没.*实时|查不到/.test(modelReply);
  if (!weather.trim() || !asksTemperature || !modelClaimsNoWeather) {
    return modelReply;
  }
  return `查到了，${weather}。结合这个气温来看，之前建议的轻薄外套主要是应对早晚温差——中午觉得热可以随时脱掉。要是你希望完全不要外套，告诉我一声，我可以马上改成无外套版本。`;
}

export const PURCHASE_PAIRING_ANCHOR_FOLLOWUP =
  '方便描述一下您想搭配的单品吗？或者再发一张清晰的服装图片～';

export const WARDROBE_OCCASION_FOLLOWUP =
  '请问您打算在什么场合穿呢？例如上班通勤、约会或日常休闲～';

export const CITY_WEATHER_FOLLOWUP_SUFFIX =
  '顺便告诉我您在哪个城市，方便结合当地天气给您更合适的穿搭建议～';

export function buildWardrobeOccasionFollowup(includeCityAsk: boolean): string {
  if (!includeCityAsk) return WARDROBE_OCCASION_FOLLOWUP;
  return `${WARDROBE_OCCASION_FOLLOWUP}${CITY_WEATHER_FOLLOWUP_SUFFIX}`;
}

// ─── Internal finalize context type ────────────────────────────────────────────

interface FinalizeContext {
  intent: GatekeeperIntent;
  modelFollowups: string[];
  modelReply?: string;
  modelIsComplete?: boolean;
  suggestCityForWeather?: boolean;
  wardrobeResolver?: WardrobeResolverResult;
  currentMessageText?: string;
  history?: Content[];
}

type RequestTypeHandler = (ctx: FinalizeContext) => GatekeeperFinalizeResult;

// ─── Shared helper ─────────────────────────────────────────────────────────────

function blockForMissingOccasion(ctx: FinalizeContext): GatekeeperFinalizeResult {
  const defaultFollowup = buildWardrobeOccasionFollowup(
    Boolean(ctx.suggestCityForWeather && !ctx.intent.weather.trim())
  );
  return {
    is_complete: false,
    extracted_intent: ctx.intent,
    followup_questions: ctx.modelFollowups.length > 0 ? ctx.modelFollowups : [defaultFollowup],
  };
}

// ─── Per-type handlers ─────────────────────────────────────────────────────────

const handleClarify: RequestTypeHandler = ({ intent, modelReply, modelFollowups, currentMessageText }) => {
  console.log('[GATEKEEPER] clarify — Gatekeeper 直接追问意图，短路下游');
  let reply = modelReply || modelFollowups.join(' ') || CLARIFY_INTENT_FOLLOWUP;
  if (modelReply && intent.weather.trim() && currentMessageText) {
    reply = buildWeatherAwareClarifyReply(modelReply, intent.weather, currentMessageText);
  }
  return {
    is_complete: false,
    extracted_intent: intent,
    followup_questions: [],
    gatekeeper_reply: reply,
  };
};

const handleOutfitConfirmed: RequestTypeHandler = ({ intent, modelReply, modelFollowups }) => {
  const label = outfitIdToLabel(intent.selected_outfit_id);
  console.log('[GATEKEEPER] outfit_confirmed — 方案已定稿，短路下游');
  return {
    is_complete: false,
    extracted_intent: intent,
    followup_questions: [],
    gatekeeper_reply:
      modelReply || modelFollowups.join(' ') || buildOutfitConfirmedGatekeeperReply(label),
  };
};

const handleOutfitSelection: RequestTypeHandler = ({ intent, modelReply, modelFollowups }) => {
  const label = outfitIdToLabel(intent.selected_outfit_id);
  console.log('[GATEKEEPER] outfit_selection — Gatekeeper 直接确认并追问，短路下游');
  return {
    is_complete: false,
    extracted_intent: intent,
    followup_questions: [],
    gatekeeper_reply:
      modelReply || modelFollowups.join(' ') || buildOutfitSelectionGatekeeperReply(label),
  };
};

const handleFeedbackRevision: RequestTypeHandler = (ctx) => {
  let intent = { ...ctx.intent, session_item_id: '' };
  const currentText = ctx.currentMessageText?.trim() ?? '';
  const llmSelected =
    intent.selected_outfit_id === 'outfit_1' || intent.selected_outfit_id === 'outfit_2'
      ? intent.selected_outfit_id
      : '';
  // 选套优先级：本轮原文 > 历史用户选套 > LLM（仅当 special_requests 能印证，防幻觉默认 outfit_1）
  const corroboratedLlmSelected =
    llmSelected && extractOutfitIdFromText(intent.special_requests) === llmSelected
      ? llmSelected
      : '';
  const resolvedOutfitId =
    extractOutfitIdFromText(currentText) ||
    (ctx.history ? inferSelectedOutfitIdFromHistory(ctx.history) : '') ||
    corroboratedLlmSelected;

  if (resolvedOutfitId) {
    intent = { ...intent, selected_outfit_id: resolvedOutfitId };
    return { is_complete: true, extracted_intent: intent, followup_questions: [] };
  }

  intent = { ...intent, selected_outfit_id: '' };
  const multipleOutfits = ctx.history ? historyShowsMultipleOutfits(ctx.history) : false;

  if (multipleOutfits) {
    console.log('[GATEKEEPER] feedback_revision — 多套方案且未选套，追问用户');
    return {
      is_complete: false,
      extracted_intent: intent,
      followup_questions: [],
      gatekeeper_reply: ctx.modelReply || buildFeedbackRevisionOutfitClarifyReply(),
    };
  }

  intent = { ...intent, selected_outfit_id: 'outfit_1' };
  return { is_complete: true, extracted_intent: intent, followup_questions: [] };
};

const handleWardrobePairing: RequestTypeHandler = (ctx) => {
  let intent = ctx.intent;
  const { modelReply, modelFollowups, wardrobeResolver: resolver, currentMessageText } = ctx;
  const browseOnly = isWardrobeBrowseIntent(intent, currentMessageText);

  if (resolver?.status === 'color_mismatch' && !intent.anchor_wardrobe_id?.trim()) {
    return {
      is_complete: false,
      extracted_intent: intent,
      followup_questions: [],
      gatekeeper_reply: buildColorMismatchReply(resolver.queriedSummary, resolver.nearMiss),
      wardrobe_candidates: [resolver.nearMiss],
    };
  }

  if (resolver?.status === 'not_found' && !intent.anchor_wardrobe_id?.trim()) {
    return {
      is_complete: false,
      extracted_intent: intent,
      followup_questions: [],
      gatekeeper_reply: modelReply || WARDROBE_NOT_FOUND_REPLY,
    };
  }

  if (resolver?.status === 'ambiguous' && !intent.anchor_wardrobe_id?.trim()) {
    return {
      is_complete: false,
      extracted_intent: intent,
      followup_questions: browseOnly ? [] : modelFollowups,
      gatekeeper_reply:
        modelReply ||
        (browseOnly
          ? buildWardrobeBrowseReply(resolver.candidates.length)
          : buildWardrobeAmbiguousReply()),
      wardrobe_candidates: resolver.candidates,
    };
  }

  if (resolver?.status === 'resolved' && !intent.anchor_wardrobe_id?.trim()) {
    intent = { ...intent, anchor_wardrobe_id: resolver.itemId };
  }

  if (browseOnly && resolver?.status === 'resolved') {
    return {
      is_complete: false,
      extracted_intent: intent,
      followup_questions: [],
      gatekeeper_reply: buildWardrobeBrowseReply(1),
      wardrobe_candidates: [resolver.item],
    };
  }

  if (!isWardrobePairingAnchorReady(intent)) {
    if (!intent.anchor_item_summary.trim()) {
      return {
        is_complete: false,
        extracted_intent: intent,
        followup_questions:
          modelFollowups.length > 0 ? modelFollowups : [PURCHASE_PAIRING_ANCHOR_FOLLOWUP],
      };
    }
    return {
      is_complete: false,
      extracted_intent: intent,
      followup_questions: [],
      gatekeeper_reply: modelReply || buildWardrobeAmbiguousReply(),
      wardrobe_candidates:
        resolver?.status === 'ambiguous' ? resolver.candidates : undefined,
    };
  }

  if (!intent.occasion.trim()) {
    return blockForMissingOccasion({ ...ctx, intent });
  }

  return { is_complete: true, extracted_intent: intent, followup_questions: [] };
};

const handlePurchasePairing: RequestTypeHandler = ({ intent, modelFollowups }) => {
  if (!isPurchasePairingAnchorReady(intent)) {
    console.warn('[GATEKEEPER] purchase_pairing blocked: missing anchor fields');
    return {
      is_complete: false,
      extracted_intent: intent,
      followup_questions:
        modelFollowups.length > 0 ? modelFollowups : [PURCHASE_PAIRING_ANCHOR_FOLLOWUP],
    };
  }
  return { is_complete: true, extracted_intent: intent, followup_questions: [] };
};

const handleStyleAdvice: RequestTypeHandler = ({ intent }) => {
  console.log('[GATEKEEPER] style_advice — 放行，由 Stylist 以建议模式回答');
  return { is_complete: true, extracted_intent: intent, followup_questions: [] };
};

const handleWardrobeOutfit: RequestTypeHandler = (ctx) => {
  if (!ctx.intent.occasion.trim()) {
    return blockForMissingOccasion(ctx);
  }
  return { is_complete: true, extracted_intent: ctx.intent, followup_questions: [] };
};

// ─── Handler registry ──────────────────────────────────────────────────────────

/**
 * request_type → 处理策略 的穷尽式注册表。
 * 新增 OutfitRequestType 时，TS 会在此处强制要求补充对应 handler。
 */
const REQUEST_TYPE_HANDLERS: Record<OutfitRequestType, RequestTypeHandler> = {
  clarify: handleClarify,
  outfit_confirmed: handleOutfitConfirmed,
  outfit_selection: handleOutfitSelection,
  feedback_revision: handleFeedbackRevision,
  wardrobe_pairing: handleWardrobePairing,
  purchase_pairing: handlePurchasePairing,
  style_advice: handleStyleAdvice,
  wardrobe_outfit: handleWardrobeOutfit,
};

/** 全部合法 request_type（从注册表派生，单一真源，避免各处清单漂移） */
export const ALL_REQUEST_TYPES = Object.keys(REQUEST_TYPE_HANDLERS) as OutfitRequestType[];

export function isValidRequestType(value: string): value is OutfitRequestType {
  return Object.prototype.hasOwnProperty.call(REQUEST_TYPE_HANDLERS, value);
}

/** 硬校验放行条件，防止 LLM 误标 is_complete 导致 pairing 静默降级 */
export function finalizeGatekeeperResult(
  input: FinalizeGatekeeperInput
): GatekeeperFinalizeResult {
  const intent = normalizeGatekeeperIntent(input.extracted_intent);
  const handler = REQUEST_TYPE_HANDLERS[intent.request_type] ?? handleWardrobeOutfit;
  return handler({
    intent,
    modelFollowups: input.followup_questions?.filter((q) => q.trim()) ?? [],
    modelReply: input.gatekeeper_reply?.trim(),
    modelIsComplete: input.modelIsComplete,
    suggestCityForWeather: input.suggestCityForWeather,
    wardrobeResolver: input.wardrobeResolver,
    currentMessageText: input.currentMessageText,
    history: input.history,
  });
}
