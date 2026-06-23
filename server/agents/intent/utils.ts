import { Content, Part } from '@google/genai';
import { enrichWeather } from '@/server/services/amapWeatherService';
import {
  AnchorItemImageData,
  AnchorItemInfo,
  AnchorSlot,
  DressingClimate,
  GatekeeperIntent,
  DEFAULT_GATEKEEPER_INTENT,
  WeatherEnrichmentContext,
} from './typeDefs';

// ─── Regex patterns ────────────────────────────────────────────────────────────

export const ACCESSORY_ANCHOR_PATTERN =
  /耳环|耳钉|耳坠|项链|颈链|手链|手镯|戒指|吊坠|胸针|发夹|发饰|手表|腰带|皮带|围巾|丝巾|帽子|贝雷帽|棒球帽|手提包|单肩包|斜挎包|墨镜|眼镜|配饰|choker|earring|necklace|bracelet|ring|pendant|scarf|belt|handbag/i;

const CASUAL_OCCASION_PATTERN = /平时|日常|百搭|通勤|上班|都可以穿|随便穿/i;

const OUTFIT_2_IN_TEXT = /第二套|outfit_2|方案二|第\s*2\s*套/;
const OUTFIT_1_IN_TEXT = /第一套|outfit_1|方案一|第\s*1\s*套/;
const MULTIPLE_OUTFITS_IN_TEXT = /方案二|第二套|outfit_2|第\s*2\s*套|两套方案|两套穿搭|准备了\s*2\s*套|两套/;

const ANCHOR_SLOT_SET = new Set<string>(['top', 'bottom', 'dress', 'shoes', 'outerwear', 'accessory']);
const DRESSING_CLIMATE_SET = new Set<string>(['cold', 'warm', 'mild']);

const ANCHOR_COLD_CLIMATE_HINT =
  /冬季|冬天|寒冷|下雪|保暖|winter|cold|snow|羽绒|厚外套|毛呢|呢大衣|羊绒|棉服/i;
const ANCHOR_WARM_CLIMATE_HINT = /夏季|夏天|防晒|轻薄|短袖|短裤|吊带|海滩|海边|beach|summer/i;
const ANCHOR_OUTERWEAR_HINT = /外套|大衣|风衣|夹克|coat|jacket|parka|blazer|cardigan/i;

const WARDROBE_ID_CONFIRM_PATTERN =
  /(?:确认选择这件单品|就是这件|选这件|id=)\s*[（(]?([a-z0-9]{20,})/i;

const COMMON_CITY_NAMES = [
  '北京', '上海', '广州', '深圳', '杭州', '南京', '苏州', '成都', '重庆', '武汉',
  '西安', '天津', '青岛', '大连', '厦门', '福州', '长沙', '郑州', '济南', '合肥',
  '昆明', '贵阳', '南宁', '海口', '三亚', '哈尔滨', '沈阳', '长春', '石家庄', '太原',
  '南昌', '宁波', '无锡', '常州', '温州', '东莞', '佛山', '珠海', '惠州', '中山',
  '嘉兴', '绍兴', '金华', '台州', '拉萨', '乌鲁木齐', '兰州', '银川', '西宁', '呼和浩特',
];

const CITY_IN_TEXT_PATTERNS = [
  /(?:我在|位于|人在|来到|来到|去到了?|到了?)([\u4e00-\u9fa5]{2,8})/,
  /([\u4e00-\u9fa5]{2,8})(?:市|这边|那里|天气|今天)/,
];

// ─── Text / History extraction ─────────────────────────────────────────────────

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

export function extractAssistantTextFromHistory(history: Content[]): string {
  return history
    .filter((msg) => msg.role === 'model')
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

// ─── Outfit selection helpers ──────────────────────────────────────────────────

export function outfitIdToLabel(outfitId?: string): string {
  return outfitId === 'outfit_2' ? '第二套' : '第一套';
}

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

// ─── Occasion / city / weather ─────────────────────────────────────────────────

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
  console.log(`[WEATHER] Fetching weather — city="${city || '(ip fallback)'}" ip="${ctx.clientIp || '-'}"`);
  const weather = await enrichWeather({
    city: city || undefined,
    ip: ctx.clientIp,
  });
  if (weather) console.log(`[WEATHER] Result: ${weather}`);
  else console.log('[WEATHER] No weather data returned');

  if (!weather) return intent;

  return {
    ...intent,
    city: city || intent.city,
    weather,
  };
}

// ─── Anchor slot ───────────────────────────────────────────────────────────────

export function parseAnchorSlot(value?: string): AnchorSlot | '' {
  const slot = value?.trim().toLowerCase();
  if (slot && ANCHOR_SLOT_SET.has(slot)) return slot as AnchorSlot;
  return '';
}

function inferAnchorSlotFromText(text: string): AnchorSlot | '' {
  const normalized = text.trim();
  if (!normalized) return '';
  if (ACCESSORY_ANCHOR_PATTERN.test(normalized)) return 'accessory';
  if (
    /外套|夹克|风衣|大衣|毛呢|呢大衣|羊绒|羽绒|棉服|jacket|coat|cardigan|windbreaker|blazer|parka/i.test(normalized)
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

// ─── Dressing climate ──────────────────────────────────────────────────────────

export function parseDressingClimate(value?: string): DressingClimate | '' {
  const normalized = value?.trim().toLowerCase();
  if (normalized && DRESSING_CLIMATE_SET.has(normalized)) {
    return normalized as DressingClimate;
  }
  return '';
}

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

// ─── Intent type predicates ────────────────────────────────────────────────────

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

// ─── Anchor item getters ───────────────────────────────────────────────────────

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
export function getResolvedAnchorFromIntent(
  intent: GatekeeperIntent
): (AnchorItemInfo & { wardrobeId?: string }) | null {
  const wardrobe = getWardrobeAnchorFromIntent(intent);
  if (wardrobe) return { ...wardrobe, wardrobeId: intent.anchor_wardrobe_id };
  return getAnchorItemFromIntent(intent);
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

// ─── Intent normalization ──────────────────────────────────────────────────────

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
