import { Content, Part } from '@google/genai';
import { enrichWeather } from '@/server/services/amapWeatherService';

export type OutfitRequestType =
  | 'wardrobe_outfit'
  | 'wardrobe_pairing'
  | 'purchase_pairing'
  | 'feedback_revision'
  | 'outfit_selection'
  | 'outfit_confirmed'
  | 'clarify';

export type AnchorSlot = 'top' | 'bottom' | 'dress' | 'shoes' | 'outerwear' | 'accessory';

/** 本轮搭配适用的穿衣气候，供 RAG 季节过滤；由 Gatekeeper 推断，服务端仅做锚点矛盾纠错 */
export type DressingClimate = 'cold' | 'warm' | 'mild';

export interface AnchorItemInfo {
  name: string;
  summary: string;
  slot: AnchorSlot;
  imageData?: AnchorItemImageData;
}

export interface AnchorItemImageData {
  data: string;
  mimeType: string;
}

export interface GatekeeperIntent {
  weather: string;
  city?: string;
  occasion: string;
  style_preference: string;
  special_requests: string;
  request_type: OutfitRequestType;
  anchor_item_summary: string;
  anchor_slot: AnchorSlot | '';
  anchor_item_image_data?: AnchorItemImageData;
  /** outfit_selection 时用户选中的方案 id，如 outfit_1 */
  selected_outfit_id?: string;
  /** wardrobe_pairing 时已确认的衣橱单品 id */
  anchor_wardrobe_id?: string;
  /** 本轮搭配的穿衣气候：cold 秋冬保暖 / warm 春夏轻薄 / mild 过渡季或场合不明确 */
  dressing_climate: DressingClimate | '';
}

export interface WardrobeAnchorCandidate {
  id: string;
  imageUrl: string;
  subCategory: string;
  colors: string[];
  similarity?: number;
}

export type WardrobeResolverResult =
  | { status: 'resolved'; itemId: string; item: WardrobeAnchorCandidate }
  | { status: 'ambiguous'; candidates: WardrobeAnchorCandidate[] }
  | { status: 'not_found' };

export const DEFAULT_GATEKEEPER_INTENT: GatekeeperIntent = {
  weather: '',
  occasion: '',
  style_preference: '日常休闲',
  special_requests: '',
  request_type: 'wardrobe_outfit',
  anchor_item_summary: '',
  anchor_slot: '',
  dressing_climate: '',
};

const ACCESSORY_ANCHOR_PATTERN =
  /耳环|耳钉|耳坠|项链|颈链|手链|手镯|戒指|吊坠|胸针|发夹|发饰|手表|腰带|皮带|围巾|丝巾|帽子|贝雷帽|棒球帽|手提包|单肩包|斜挎包|墨镜|眼镜|配饰|choker|earring|necklace|bracelet|ring|pendant|scarf|belt|handbag/i;

const CASUAL_OCCASION_PATTERN = /平时|日常|百搭|通勤|上班|都可以穿|随便穿/i;

export function outfitIdToLabel(outfitId?: string): string {
  return outfitId === 'outfit_2' ? '第二套' : '第一套';
}

export function buildOutfitSelectionGatekeeperReply(outfitLabel: string): string {
  return `好的，${outfitLabel}～这套可以直接穿出门，还是想在鞋子、外套或配饰上微调一下？`;
}

export function buildOutfitConfirmedGatekeeperReply(outfitLabel: string): string {
  return `太好了！${outfitLabel}就定下来啦～祝您穿出好心情，有需要随时再来找我～`;
}

const OUTFIT_2_IN_TEXT = /第二套|outfit_2|方案二|第\s*2\s*套/;
const OUTFIT_1_IN_TEXT = /第一套|outfit_1|方案一|第\s*1\s*套/;
const MULTIPLE_OUTFITS_IN_TEXT = /方案二|第二套|outfit_2|第\s*2\s*套|两套方案|两套穿搭|准备了\s*2\s*套|两套/;

/** 从单条用户消息中提取明确选套信号 */
export function extractOutfitIdFromText(text: string): 'outfit_1' | 'outfit_2' | '' {
  const normalized = text.trim();
  if (!normalized) return '';
  if (OUTFIT_2_IN_TEXT.test(normalized)) return 'outfit_2';
  if (OUTFIT_1_IN_TEXT.test(normalized)) return 'outfit_1';
  return '';
}

export function userMentionedOutfitIdInText(text: string): boolean {
  return extractOutfitIdFromText(text) !== '';
}

export function extractAssistantTextFromHistory(history: Content[]): string {
  return history
    .filter((msg) => msg.role === 'model')
    .flatMap((msg) => extractTextFromParts(msg.parts ?? []))
    .join('\n');
}

/** 历史助手回复中是否出现过多套方案 */
export function historyShowsMultipleOutfits(history: Content[]): boolean {
  return MULTIPLE_OUTFITS_IN_TEXT.test(extractAssistantTextFromHistory(history));
}

/** 从用户历史消息（新→旧）推断已选方案 */
export function inferSelectedOutfitIdFromHistory(history: Content[]): 'outfit_1' | 'outfit_2' | '' {
  const userMessages = history
    .filter((msg) => msg.role === 'user')
    .map((msg) => extractTextFromParts(msg.parts ?? []))
    .filter(Boolean);

  for (let i = userMessages.length - 1; i >= 0; i--) {
    const id = extractOutfitIdFromText(userMessages[i]);
    if (id) return id;
  }
  return '';
}

export function buildFeedbackRevisionOutfitClarifyReply(): string {
  return '好的～上一轮给您准备了多套方案，请问您想微调第一套还是第二套？';
}

export const CLARIFY_INTENT_FOLLOWUP =
  '想确认一下您的需求～您是想让我从衣橱里搭一套穿搭，还是有某件单品想搭配，或者要在上一套方案上做调整呢？';

export const WARDROBE_NOT_FOUND_REPLY =
  '没在衣橱里找到匹配的单品～可以描述得更具体一些（颜色、款式），或者发一张该单品的照片给我～';

export function buildWardrobeAmbiguousReply(): string {
  return '我在您的衣橱里找到了几件相似的单品，请点击确认您想穿的是哪一件～';
}

const COMMON_CITY_NAMES = [
  '北京',
  '上海',
  '广州',
  '深圳',
  '杭州',
  '南京',
  '苏州',
  '成都',
  '重庆',
  '武汉',
  '西安',
  '天津',
  '青岛',
  '大连',
  '厦门',
  '福州',
  '长沙',
  '郑州',
  '济南',
  '合肥',
  '昆明',
  '贵阳',
  '南宁',
  '海口',
  '三亚',
  '哈尔滨',
  '沈阳',
  '长春',
  '石家庄',
  '太原',
  '南昌',
  '宁波',
  '无锡',
  '常州',
  '温州',
  '东莞',
  '佛山',
  '珠海',
  '惠州',
  '中山',
  '嘉兴',
  '绍兴',
  '金华',
  '台州',
  '拉萨',
  '乌鲁木齐',
  '兰州',
  '银川',
  '西宁',
  '呼和浩特',
];

const CITY_IN_TEXT_PATTERNS = [
  /(?:我在|位于|人在|来到|来到|去到了?|到了?)([\u4e00-\u9fa5]{2,8})/,
  /([\u4e00-\u9fa5]{2,8})(?:市|这边|那里|天气|今天)/,
];

export interface WeatherEnrichmentContext {
  clientIp?: string;
  profileLocation?: string;
  contextText?: string;
}

/** Extract a Chinese city name from user conversation text. */
export function extractCityFromText(text: string): string {
  const normalized = text.trim();
  if (!normalized) return '';

  for (const city of COMMON_CITY_NAMES) {
    if (normalized.includes(city)) return city;
  }

  for (const pattern of CITY_IN_TEXT_PATTERNS) {
    const match = normalized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate && candidate.length >= 2 && candidate.length <= 8) {
      return candidate.replace(/市$/, '');
    }
  }

  return '';
}

function resolveWeatherCity(intent: GatekeeperIntent, ctx: WeatherEnrichmentContext): string {
  return (
    intent.city?.trim() ||
    extractCityFromText(ctx.contextText ?? '') ||
    ctx.profileLocation?.trim() ||
    ''
  );
}

export async function enrichIntentWeather(
  intent: GatekeeperIntent,
  ctx: WeatherEnrichmentContext
): Promise<GatekeeperIntent> {
  if (intent.weather.trim()) return intent;

  const city = resolveWeatherCity(intent, ctx);
  const weather = await enrichWeather({
    city: city || undefined,
    ip: ctx.clientIp,
  });

  if (!weather) return intent;

  return {
    ...intent,
    city: city || intent.city,
    weather,
  };
}

export function isPurchasePairingIntent(intent: GatekeeperIntent): boolean {
  return intent.request_type === 'purchase_pairing';
}

export function isWardrobePairingIntent(intent: GatekeeperIntent): boolean {
  return intent.request_type === 'wardrobe_pairing';
}

export function isAnchorPairingIntent(intent: GatekeeperIntent): boolean {
  return isPurchasePairingIntent(intent) || isWardrobePairingIntent(intent);
}

export function isOutfitGeneratingIntent(intent: GatekeeperIntent): boolean {
  return (
    intent.request_type === 'wardrobe_outfit' ||
    intent.request_type === 'wardrobe_pairing' ||
    intent.request_type === 'purchase_pairing' ||
    intent.request_type === 'feedback_revision'
  );
}

const DRESSING_CLIMATE_SET = new Set<string>(['cold', 'warm', 'mild']);

export function parseDressingClimate(value?: string): DressingClimate | '' {
  const normalized = value?.trim().toLowerCase();
  if (normalized && DRESSING_CLIMATE_SET.has(normalized)) {
    return normalized as DressingClimate;
  }
  return '';
}

const ANCHOR_COLD_CLIMATE_HINT =
  /冬季|冬天|寒冷|下雪|保暖|winter|cold|snow|羽绒|厚外套|毛呢|呢大衣|羊绒|棉服/i;

const ANCHOR_WARM_CLIMATE_HINT = /夏季|夏天|防晒|轻薄|短袖|短裤|吊带|海滩|海边|beach|summer/i;

const ANCHOR_OUTERWEAR_HINT = /外套|大衣|风衣|夹克|coat|jacket|parka|blazer|cardigan/i;

/** 仅从锚点摘要推断穿衣气候，用于 enrich 补全或矛盾纠错 */
export function inferDressingClimateFromAnchor(intent: GatekeeperIntent): DressingClimate | '' {
  const summary = intent.anchor_item_summary.trim();
  if (!summary) return '';
  if (
    ANCHOR_COLD_CLIMATE_HINT.test(summary) ||
    (intent.anchor_slot === 'outerwear' && ANCHOR_OUTERWEAR_HINT.test(summary))
  ) {
    return 'cold';
  }
  if (ANCHOR_WARM_CLIMATE_HINT.test(summary)) return 'warm';
  return '';
}

export function correctDressingClimate(intent: GatekeeperIntent): GatekeeperIntent {
  if (!isOutfitGeneratingIntent(intent)) return intent;

  const fromAnchor = inferDressingClimateFromAnchor(intent);
  const current = parseDressingClimate(intent.dressing_climate);

  if (!current && fromAnchor) {
    console.warn(`[INTENT] Filling dressing_climate from anchor: ${fromAnchor}`);
    intent.dressing_climate = fromAnchor;
    return intent;
  }

  if (
    current &&
    fromAnchor &&
    ((fromAnchor === 'cold' && current === 'warm') || (fromAnchor === 'warm' && current === 'cold'))
  ) {
    console.warn(`[INTENT] Correcting dressing_climate: ${current} → ${fromAnchor}`);
    intent.dressing_climate = fromAnchor;
  }

  return intent;
}

export function extractTextFromParts(parts: Part[]): string {
  return parts
    .filter((part): part is { text: string } => 'text' in part && typeof part.text === 'string')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n');
}

export function extractUserTextFromHistory(history: Content[]): string {
  return history
    .filter((msg) => msg.role === 'user')
    .flatMap((msg) => extractTextFromParts(msg.parts ?? []))
    .join('\n');
}

export function collectImageParts(history: Content[], currentInput: Part[]): Part[] {
  const images: Part[] = [];
  for (const msg of history) {
    if (msg.role !== 'user') continue;
    for (const part of msg.parts ?? []) {
      if ('inlineData' in part && part.inlineData) images.push(part);
    }
  }
  for (const part of currentInput) {
    if ('inlineData' in part && part.inlineData) images.push(part);
  }
  return images;
}

export function collectLatestImageData(
  history: Content[],
  currentInput: Part[]
): AnchorItemImageData | undefined {
  const images = collectImageParts(history, currentInput);
  for (let i = images.length - 1; i >= 0; i--) {
    const inline = 'inlineData' in images[i] ? images[i].inlineData : undefined;
    if (inline?.data && inline?.mimeType) {
      return { data: inline.data, mimeType: inline.mimeType };
    }
  }
  return undefined;
}

export function inferOccasionFromText(text: string): string {
  if (/上班|通勤|开会|办公室|工作/.test(text)) return '上班通勤';
  if (/徒步|爬山|户外/.test(text)) return '户外徒步';
  if (/约会/.test(text)) return '约会';
  if (/运动|健身|跑步|球/.test(text)) return '运动';
  if (/聚会|派对|晚宴|婚礼/.test(text)) return '聚会';
  if (/逛街|购物|商场/.test(text)) return '逛街';
  if (CASUAL_OCCASION_PATTERN.test(text)) return '日常百搭';
  return '';
}

const ANCHOR_SLOT_SET = new Set<string>(['top', 'bottom', 'dress', 'shoes', 'outerwear', 'accessory']);

/** Infer anchor slot from a single text blob (summary or context). */
function inferAnchorSlotFromText(text: string): AnchorSlot | '' {
  const normalized = text.trim();
  if (!normalized) return '';
  if (ACCESSORY_ANCHOR_PATTERN.test(normalized)) return 'accessory';
  if (
    /外套|夹克|风衣|大衣|毛呢|呢大衣|羊绒|羽绒|棉服|jacket|coat|cardigan|windbreaker|blazer|parka/i.test(
      normalized
    )
  ) {
    return 'outerwear';
  }
  if (/连衣裙|连身裙|one.?piece|dress/i.test(normalized)) return 'dress';
  if (/半裙|短裙|A字裙|skirt/i.test(normalized)) return 'bottom';
  if (/裙(?!链|带)/i.test(normalized)) return 'dress';
  if (/裤|jeans|trousers|pants|shorts/i.test(normalized)) return 'bottom';
  if (/鞋|靴|sneaker|loafer|heel|boot/i.test(normalized)) return 'shoes';
  if (/衬衫|上衣|T恤|针织|背心|blouse|top|tee/i.test(normalized)) return 'top';
  return '';
}

/** Infer anchor slot from item description; summary takes priority over conversation context. */
export function inferAnchorSlotFromSummary(summary: string, contextText = ''): AnchorSlot | '' {
  const fromSummary = inferAnchorSlotFromText(summary);
  if (fromSummary) return fromSummary;
  return inferAnchorSlotFromText(contextText);
}

export function correctAnchorSlot(intent: GatekeeperIntent, contextText = ''): GatekeeperIntent {
  if (!isAnchorPairingIntent(intent)) return intent;

  const inferred = inferAnchorSlotFromSummary(intent.anchor_item_summary, contextText);
  if (inferred && intent.anchor_slot !== inferred) {
    console.warn(
      `[INTENT] Correcting anchor_slot: ${intent.anchor_slot || '(empty)'} → ${inferred} (${intent.anchor_item_summary.slice(0, 40)}...)`
    );
    intent.anchor_slot = inferred;
  }
  return intent;
}

export function parseAnchorSlot(value?: string): AnchorSlot | '' {
  const slot = value?.trim().toLowerCase();
  if (slot && ANCHOR_SLOT_SET.has(slot)) return slot as AnchorSlot;
  return '';
}

export function normalizeGatekeeperIntent(
  intent: Partial<GatekeeperIntent> | undefined
): GatekeeperIntent {
  const merged = { ...DEFAULT_GATEKEEPER_INTENT, ...intent };
  if (!merged.request_type) merged.request_type = 'wardrobe_outfit';
  merged.anchor_slot = parseAnchorSlot(merged.anchor_slot || undefined);
  merged.dressing_climate = parseDressingClimate(
    typeof merged.dressing_climate === 'string' ? merged.dressing_climate : ''
  );
  return merged;
}

/** 从 Gatekeeper 已提取的 intent 读取待购锚定单品（purchase_pairing） */
export function getAnchorItemFromIntent(intent: GatekeeperIntent): AnchorItemInfo | null {
  if (!isPurchasePairingIntent(intent)) return null;
  const summary = intent.anchor_item_summary.trim();
  const slot = intent.anchor_slot;
  if (!summary || !slot) return null;
  return {
    name: summary.split(/[，,]/)[0]?.trim() || summary,
    summary,
    slot,
    imageData: intent.anchor_item_image_data,
  };
}

/** 从 Gatekeeper 已提取的 intent 读取衣橱锚定单品（wardrobe_pairing） */
export function getWardrobeAnchorFromIntent(intent: GatekeeperIntent): AnchorItemInfo | null {
  if (!isWardrobePairingIntent(intent)) return null;
  const wardrobeId = intent.anchor_wardrobe_id?.trim();
  const slot = intent.anchor_slot;
  if (!wardrobeId || !slot) return null;
  const summary = intent.anchor_item_summary.trim() || '衣橱锚定单品';
  return {
    name: summary.split(/[，,]/)[0]?.trim() || summary,
    summary,
    slot,
    imageData: intent.anchor_item_image_data,
  };
}

/** 统一的锚定单品读取：衣橱锚定用真实 id，待购锚定用 new_item */
export function getResolvedAnchorFromIntent(intent: GatekeeperIntent): (AnchorItemInfo & { wardrobeId?: string }) | null {
  const wardrobe = getWardrobeAnchorFromIntent(intent);
  if (wardrobe) return { ...wardrobe, wardrobeId: intent.anchor_wardrobe_id };
  return getAnchorItemFromIntent(intent);
}

const WARDROBE_ID_CONFIRM_PATTERN =
  /(?:确认选择这件单品|就是这件|选这件|id=)\s*[（(]?([a-z0-9]{20,})/i;

export function extractConfirmedWardrobeId(text: string): string {
  const match = text.match(WARDROBE_ID_CONFIRM_PATTERN);
  return match?.[1]?.trim() ?? '';
}

export function buildPurchasePairingSpecialRequest(anchorSummary: string): string {
  const anchor = anchorSummary.trim() || '用户上传/提及的待购单品';
  return `用户待购单品（${anchor}）需作为搭配锚点，从衣橱中选取互补单品与之搭配`;
}

export function buildWardrobePairingSpecialRequest(anchorSummary: string): string {
  const anchor = anchorSummary.trim() || '用户指定的衣橱单品';
  return `用户衣橱单品（${anchor}）需作为搭配锚点，从衣橱中选取互补单品与之搭配`;
}

export function enrichIntentFromContext(
  intent: GatekeeperIntent,
  history: Content[],
  currentInput: Part[]
): GatekeeperIntent {
  const contextText = `${extractUserTextFromHistory(history)}\n${extractTextFromParts(currentInput)}`.trim();
  const normalized = normalizeGatekeeperIntent(intent);

  const currentText = extractTextFromParts(currentInput);
  const confirmedWardrobeId = extractConfirmedWardrobeId(currentText);

  if (isWardrobePairingIntent(normalized) && confirmedWardrobeId) {
    normalized.anchor_wardrobe_id = confirmedWardrobeId;
  }

  // request_type 完全以 Gatekeeper LLM 判定为准，这里做 pairing 类意图的结构化数据补全
  if (isWardrobePairingIntent(normalized)) {
    if (!normalized.occasion.trim()) {
      normalized.occasion = inferOccasionFromText(contextText) || '';
    }
    if (!normalized.special_requests.trim()) {
      normalized.special_requests = buildWardrobePairingSpecialRequest(normalized.anchor_item_summary);
    }
    correctAnchorSlot(normalized, contextText);
  }

  if (isPurchasePairingIntent(normalized)) {
    if (!normalized.occasion.trim()) {
      normalized.occasion = inferOccasionFromText(contextText) || '日常百搭';
    }
    if (!normalized.special_requests.trim()) {
      normalized.special_requests = buildPurchasePairingSpecialRequest(normalized.anchor_item_summary);
    }
    if (!normalized.anchor_item_summary.trim() && ACCESSORY_ANCHOR_PATTERN.test(contextText)) {
      const match = contextText.match(
        /(?:这副|这个|这款|一条|一对)?\s*[\u4e00-\u9fa5a-zA-Z]{1,12}(?:耳环|耳钉|项链|手链|戒指|腰带|围巾|帽子|包)/
      );
      if (match) normalized.anchor_item_summary = match[0].trim();
    }
    correctAnchorSlot(normalized, contextText);
    normalized.anchor_item_image_data = collectLatestImageData(history, currentInput);
  }

  if (isOutfitGeneratingIntent(normalized)) {
    correctDressingClimate(normalized);
  }

  return normalized;
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

export function isPurchasePairingAnchorReady(intent: GatekeeperIntent): boolean {
  return (
    isPurchasePairingIntent(intent) &&
    Boolean(intent.anchor_item_summary.trim()) &&
    Boolean(intent.anchor_slot)
  );
}

export function isWardrobePairingAnchorReady(intent: GatekeeperIntent): boolean {
  return (
    isWardrobePairingIntent(intent) &&
    Boolean(intent.anchor_wardrobe_id?.trim()) &&
    Boolean(intent.anchor_slot)
  );
}

/** 硬校验放行条件，防止 LLM 误标 is_complete 导致 pairing 静默降级 */
export function finalizeGatekeeperResult(input: {
  extracted_intent: GatekeeperIntent;
  followup_questions?: string[];
  gatekeeper_reply?: string;
  suggestCityForWeather?: boolean;
  wardrobeResolver?: WardrobeResolverResult;
  currentMessageText?: string;
  history?: Content[];
}): {
  is_complete: boolean;
  extracted_intent: GatekeeperIntent;
  followup_questions: string[];
  gatekeeper_reply?: string;
  wardrobe_candidates?: WardrobeAnchorCandidate[];
} {
  let intent = normalizeGatekeeperIntent(input.extracted_intent);
  const modelFollowups = input.followup_questions?.filter((q) => q.trim()) ?? [];
  const modelReply = input.gatekeeper_reply?.trim();

  // 意图不明：搭配相关但还不能确定下一步 → Gatekeeper 直接回复追问，短路下游
  if (intent.request_type === 'clarify') {
    console.log('[GATEKEEPER] clarify — Gatekeeper 直接追问意图，短路下游');
    return {
      is_complete: false,
      extracted_intent: intent,
      followup_questions: [],
      gatekeeper_reply: modelReply || modelFollowups.join(' ') || CLARIFY_INTENT_FOLLOWUP,
    };
  }

  // 已满意定稿 → 亲切确认，不再追问微调
  if (intent.request_type === 'outfit_confirmed') {
    const label = outfitIdToLabel(intent.selected_outfit_id);
    console.log('[GATEKEEPER] outfit_confirmed — 方案已定稿，短路下游');
    return {
      is_complete: false,
      extracted_intent: intent,
      followup_questions: [],
      gatekeeper_reply:
        modelReply || modelFollowups.join(' ') || buildOutfitConfirmedGatekeeperReply(label),
    };
  }

  // 仅选定某套但未说明满意/微调 → Gatekeeper 直接确认并追问，短路下游
  if (intent.request_type === 'outfit_selection') {
    const label = outfitIdToLabel(intent.selected_outfit_id);
    console.log('[GATEKEEPER] outfit_selection — Gatekeeper 直接确认并追问，短路下游');
    return {
      is_complete: false,
      extracted_intent: intent,
      followup_questions: [],
      gatekeeper_reply:
        modelReply || modelFollowups.join(' ') || buildOutfitSelectionGatekeeperReply(label),
    };
  }

  if (intent.request_type === 'feedback_revision') {
    const currentText = input.currentMessageText?.trim() ?? '';
    const resolvedOutfitId =
      extractOutfitIdFromText(currentText) ||
      (input.history ? inferSelectedOutfitIdFromHistory(input.history) : '');

    if (resolvedOutfitId) {
      intent = { ...intent, selected_outfit_id: resolvedOutfitId };
      return { is_complete: true, extracted_intent: intent, followup_questions: [] };
    }

    intent = { ...intent, selected_outfit_id: '' };
    const multipleOutfits = input.history ? historyShowsMultipleOutfits(input.history) : false;

    if (multipleOutfits) {
      console.log('[GATEKEEPER] feedback_revision — 多套方案且未选套，追问用户');
      return {
        is_complete: false,
        extracted_intent: intent,
        followup_questions: [],
        gatekeeper_reply:
          modelReply || buildFeedbackRevisionOutfitClarifyReply(),
      };
    }

    intent = { ...intent, selected_outfit_id: 'outfit_1' };
    return { is_complete: true, extracted_intent: intent, followup_questions: [] };
  }

  if (isWardrobePairingIntent(intent)) {
    const resolver = input.wardrobeResolver;

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
        followup_questions: [],
        gatekeeper_reply: modelReply || buildWardrobeAmbiguousReply(),
        wardrobe_candidates: resolver.candidates,
      };
    }

    if (resolver?.status === 'resolved' && !intent.anchor_wardrobe_id?.trim()) {
      intent = { ...intent, anchor_wardrobe_id: resolver.itemId };
    }

    if (!isWardrobePairingAnchorReady(intent)) {
      if (!intent.anchor_item_summary.trim()) {
        return {
          is_complete: false,
          extracted_intent: intent,
          followup_questions: modelFollowups.length > 0 ? modelFollowups : [PURCHASE_PAIRING_ANCHOR_FOLLOWUP],
        };
      }
      return {
        is_complete: false,
        extracted_intent: intent,
        followup_questions: [],
        gatekeeper_reply: modelReply || buildWardrobeAmbiguousReply(),
        wardrobe_candidates: resolver?.status === 'ambiguous' ? resolver.candidates : undefined,
      };
    }

    if (!intent.occasion.trim()) {
      const defaultFollowup = buildWardrobeOccasionFollowup(
        Boolean(input.suggestCityForWeather && !intent.weather.trim())
      );
      return {
        is_complete: false,
        extracted_intent: intent,
        followup_questions: modelFollowups.length > 0 ? modelFollowups : [defaultFollowup],
      };
    }

    return { is_complete: true, extracted_intent: intent, followup_questions: [] };
  }

  if (isPurchasePairingIntent(intent)) {
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
  }

  if (!intent.occasion.trim()) {
    const defaultFollowup = buildWardrobeOccasionFollowup(
      Boolean(input.suggestCityForWeather && !intent.weather.trim())
    );
    return {
      is_complete: false,
      extracted_intent: intent,
      followup_questions: modelFollowups.length > 0 ? modelFollowups : [defaultFollowup],
    };
  }

  return { is_complete: true, extracted_intent: intent, followup_questions: [] };
}
