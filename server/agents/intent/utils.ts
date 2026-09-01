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

/**
 * ─── LLM 输出纠偏规则清单（务必先读完再新增规则）────────────────────────
 *
 * 本文件里对 Gatekeeper LLM 输出做后处理的函数分两类：
 *
 * 【A类·空值兜底】只在 LLM 漏填某字段时补默认值，不覆盖 LLM 已做的分类判断。
 * 风险低，可以按需增加：
 *   - inferOccasionFromText / extractCityFromText
 *   - buildWardrobePairingSpecialRequest / buildPurchasePairingSpecialRequest
 *   - ACCESSORY_ANCHOR_PATTERN 匹配（enrichIntentFromContext 内）
 *   - extractConfirmedWardrobeId（解析系统自己生成的确认字符串，非猜测）
 *
 * 【B类·矛盾纠正/分类裁决】覆盖 LLM 已给出的显式判断，用于修正已知的
 * 系统性误判。这类规则有风险（可能误伤未覆盖到的正常场景），当前清单：
 *   1. correctAnchorSlot                — anchor_slot 与文本描述矛盾时纠正
 *   2. correctDressingClimate           — dressing_climate 与锚点描述矛盾时纠正
 *   3. coerceWardrobeBrowseIntent       — clarify → wardrobe_pairing（衣橱浏览类误判）
 *   4. adjudicateNewTaskVsRevisionIntent — feedback_revision → wardrobe_outfit（新场景误判为微调）
 *   5. resolveWardrobeAnchorIdFromHistory — 口头确认/幻觉 id 时用上轮展示的候选纠偏
 *
 * 新增 B 类规则前请先确认：
 *   - 能否通过调整 Gatekeeper prompt/schema 描述解决？优先改 prompt。
 *   - 触发条件是否足够窄、可用正则/关键词稳定判断？不要为单一场景写规则，
 *     应抽象成通用信号（如"是否有明确修改动作词"），否则会陷入无限打补丁。
 *   - 是否补充了对应单元测试？B 类规则必须有测试覆盖。
 *   - B 类规则数量建议控制在个位数；持续增长应考虑用统一的分类裁决器替代零散规则。
 *
 * 调用顺序（server/agents/gatekeeper/agent.ts）：
 *   rawIntent → coerceWardrobeBrowseIntent → adjudicateNewTaskVsRevisionIntent → enrichIntentFromContext
 * 两者作用的 request_type 互斥（clarify vs feedback_revision），暂无顺序冲突；
 * 新增规则时需重新评估是否存在交叉影响。
 * ──────────────────────────────────────────────────────────────────────
 */

// ─── Regex patterns ────────────────────────────────────────────────────────────

export const ACCESSORY_ANCHOR_PATTERN =
  /耳环|耳钉|耳坠|项链|颈链|手链|手镯|戒指|吊坠|胸针|发夹|发饰|手表|腰带|皮带|围巾|丝巾|帽子|贝雷帽|棒球帽|手提包|单肩包|斜挎包|墨镜|眼镜|配饰|choker|earring|necklace|bracelet|ring|pendant|scarf|belt|handbag/i;

const CASUAL_OCCASION_PATTERN = /平时|日常|百搭|通勤|上班|都可以穿|随便穿/i;

const OUTFIT_2_IN_TEXT = /第二套|outfit_2|方案二|第\s*2\s*套/;
const OUTFIT_1_IN_TEXT = /第一套|outfit_1|方案一|第\s*1\s*套/;
const MULTIPLE_OUTFITS_IN_TEXT = /方案二|第二套|outfit_2|第\s*2\s*套|两套方案|两套穿搭|准备了\s*2\s*套|两套/;

const ANCHOR_SLOT_SET = new Set<string>(['top', 'bottom', 'dress', 'shoes', 'outerwear', 'accessory']);
const DRESSING_CLIMATE_SET = new Set<string>(['cold', 'warm', 'mild']);

const REVISION_TARGET_PATTERN =
  /第一套|第二套|这套|那套|上一套|刚才那套|上面那套|方案一|方案二|outfit_[12]|第\s*[12]\s*套/;
const REVISION_ACTION_PATTERN =
  /换成|改成|换一下|改一下|去掉|不要|保留|替换|调整|微调|加一件|加上|去除|换掉|太.{0,6}了|更.{0,6}一点/;
const NEW_OUTFIT_REQUEST_PATTERN =
  /穿啥|穿什么|怎么穿|怎么搭|搭配一套|配一套|来一套|出一套|穿搭方案|应该穿|适合穿/;
const OCCASION_KEYWORDS =
  '打球|踢球|运动|健身|跑步|爬山|徒步|约会|通勤|上班|面试|聚会|旅行|逛街|打篮球|踢足球|篮球|足球';
const NEW_OCCASION_PATTERN = new RegExp(`(?:去.{0,8})?(?:${OCCASION_KEYWORDS})`);

const ANCHOR_COLD_CLIMATE_HINT =
  /冬季|冬天|寒冷|下雪|保暖|winter|cold|snow|羽绒|厚外套|毛呢|呢大衣|羊绒|棉服/i;
const ANCHOR_WARM_CLIMATE_HINT = /夏季|夏天|防晒|轻薄|短袖|短裤|吊带|海滩|海边|beach|summer/i;
const ANCHOR_OUTERWEAR_HINT = /外套|大衣|风衣|夹克|coat|jacket|parka|blazer|cardigan/i;

const WARDROBE_ID_CONFIRM_PATTERN =
  /(?:确认选择这件单品|就是这件|选这件|id=)\s*[（(]?([a-z0-9]{20,})/i;

/** History marker written by formatHistoryAsync for wardrobe candidate pickers. */
const WARDROBE_CANDIDATES_HISTORY_PATTERN = /\[wardrobe_candidates:id=([a-z0-9,]+)\]/gi;

/** User verbally accepts the (usually single) presented candidate without clicking id=. */
const VERBAL_ANCHOR_ACCEPT_PATTERN =
  /这个也行|那件也行|这件也行|也可以|就这件|就这个|就是它|用这件|穿这件|帮我(?:搭|配)|按这个|选这个|确认这|对这件|好吧这/;

const VERBAL_ANCHOR_REJECT_PATTERN =
  /不是这|不要这|不对|错了|换一|重新找|不是我要|我要别的/;

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

function isImagePart(part: Part): boolean {
  return 'inlineData' in part && Boolean(part.inlineData);
}

/** 收集历史中用户上传过的图片 + 当前输入的图片，用于跨轮次找回锚点图（如先发图后补场合）。 */
function collectImageParts(history: Content[], currentInput: Part[]): Part[] {
  const historyImages = history
    .filter((msg) => msg.role === 'user')
    .flatMap((msg) => (msg.parts ?? []).filter(isImagePart));
  return [...historyImages, ...currentInput.filter(isImagePart)];
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

/**
 * Latest wardrobe_candidates ids shown by the assistant (from formatHistoryAsync markers).
 * Returns [] when none found.
 */
export function extractLatestPresentedWardrobeCandidateIds(history: Content[]): string[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== 'model') continue;
    const text = extractTextFromParts(msg.parts ?? []);
    const matches = [...text.matchAll(WARDROBE_CANDIDATES_HISTORY_PATTERN)];
    if (matches.length === 0) continue;
    const last = matches[matches.length - 1];
    return last[1]
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length >= 20);
  }
  return [];
}

export function isVerbalWardrobeAnchorAccept(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (VERBAL_ANCHOR_REJECT_PATTERN.test(trimmed)) return false;
  return VERBAL_ANCHOR_ACCEPT_PATTERN.test(trimmed);
}

/**
 * Bind wardrobe_pairing anchor id from explicit confirm or last presented singleton candidate.
 * Overrides Gatekeeper hallucinations when they conflict with the last shown singleton.
 */
export function resolveWardrobeAnchorIdFromHistory(
  intent: GatekeeperIntent,
  history: Content[],
  currentText: string
): GatekeeperIntent {
  if (!isWardrobePairingIntent(intent)) return intent;

  const explicitId = extractConfirmedWardrobeId(currentText);
  if (explicitId) {
    if (intent.anchor_wardrobe_id?.trim() !== explicitId) {
      console.warn(
        `[INTENT] Overriding anchor_wardrobe_id with explicit confirm: ${intent.anchor_wardrobe_id || '(empty)'} → ${explicitId}`
      );
    }
    return { ...intent, anchor_wardrobe_id: explicitId };
  }

  const presented = extractLatestPresentedWardrobeCandidateIds(history);
  if (presented.length !== 1) return intent;

  const singletonId = presented[0];
  const currentId = intent.anchor_wardrobe_id?.trim() ?? '';
  if (!isVerbalWardrobeAnchorAccept(currentText)) return intent;

  // Verbal accept of the only shown item — fill or override Gatekeeper hallucination.
  if (currentId !== singletonId) {
    console.warn(
      `[INTENT] Binding verbal confirm to last singleton candidate: ${currentId || '(empty)'} → ${singletonId}`
    );
  }
  return { ...intent, anchor_wardrobe_id: singletonId };
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

const WARDROBE_BROWSE_PATTERN =
  /衣橱里?(有|有没有)|有没有.{0,12}(裙|裤|衫|衣|鞋|外套|单品)|想看看|看看.{0,8}(裙|裤|衫|衣|鞋)|裙子呢|单品呢|不是.{0,6}(绿|白|黑|红|蓝|灰|黄|粉)色?的?/;

const ANCHOR_ITEM_FROM_CONTEXT_PATTERNS = [
  /(?:有没有|想看看|查看|筛选|展示|衣橱里).{0,8}((?:白|黑|红|绿|蓝|灰|米|卡其|奶油|橄榄)[色]?[\u4e00-\u9fa5]{0,4}裙)/,
  /((?:白|黑|红|绿|蓝|灰|米|卡其|奶油|橄榄)[色]?[\u4e00-\u9fa5]{0,6}(?:连衣)?裙)/,
  /((?:白|黑|红|绿|蓝|灰|米|卡其|奶油|橄榄)[色]?[\u4e00-\u9fa5]{0,6}(?:衬衫|上衣|外套|裤|鞋))/,
];

/** 用户只想浏览/确认衣橱单品，尚未进入搭配场合收集阶段 */
export function isWardrobeBrowseIntent(intent: GatekeeperIntent, currentMessageText?: string): boolean {
  const text = `${intent.special_requests}\n${currentMessageText ?? ''}`;
  return (
    WARDROBE_BROWSE_PATTERN.test(text) ||
    /查询衣橱|查看衣橱|展示衣橱|筛选出衣橱/.test(text)
  );
}

export function extractAnchorSummaryFromContext(contextText: string, currentText: string): string {
  const haystack = `${contextText}\n${currentText}`;
  for (const pattern of ANCHOR_ITEM_FROM_CONTEXT_PATTERNS) {
    const match = haystack.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return '';
}

/**
 * LLM 误判为 clarify 时，根据对话上下文纠正为 wardrobe_pairing 并补全锚点描述。
 */
export function coerceWardrobeBrowseIntent(
  intent: GatekeeperIntent,
  history: Content[],
  currentInput: Part[]
): GatekeeperIntent {
  const currentText = extractTextFromParts(currentInput);
  const contextText = `${extractUserTextFromHistory(history)}\n${currentText}`;

  const shouldCoerce =
    intent.request_type === 'clarify' &&
    (WARDROBE_BROWSE_PATTERN.test(currentText) ||
      WARDROBE_BROWSE_PATTERN.test(intent.special_requests) ||
      /查询衣橱|查看衣橱|展示|筛选/.test(intent.special_requests));

  if (!shouldCoerce) return intent;

  const summary =
    intent.anchor_item_summary.trim() ||
    extractAnchorSummaryFromContext(contextText, currentText) ||
    intent.special_requests.replace(/查询衣橱[内中]?是否有?/g, '').trim();

  const slot = intent.anchor_slot || inferAnchorSlotFromSummary(summary) || 'dress';

  console.log(
    `[GATEKEEPER] Coerced clarify → wardrobe_pairing for browse query: "${summary.slice(0, 32)}"`
  );

  return {
    ...intent,
    request_type: 'wardrobe_pairing',
    anchor_item_summary: summary,
    anchor_slot: slot,
    special_requests: intent.special_requests.trim() || currentText,
  };
}

export function hasExplicitRevisionSignal(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return REVISION_TARGET_PATTERN.test(normalized) || REVISION_ACTION_PATTERN.test(normalized);
}

export function looksLikeNewOutfitTask(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return NEW_OUTFIT_REQUEST_PATTERN.test(normalized) || NEW_OCCASION_PATTERN.test(normalized);
}

/**
 * 通用 new-task vs revision-task 裁决：
 * LLM 容易被上一轮方案带偏，把「新场景/新活动穿搭」误判为 feedback_revision。
 * 这里不识别具体场景名，只判断本轮是否缺少明确修订信号且像一个新的穿搭目标。
 */
export function adjudicateNewTaskVsRevisionIntent(
  intent: GatekeeperIntent,
  currentInput: Part[]
): GatekeeperIntent {
  if (intent.request_type !== 'feedback_revision') return intent;

  const currentText = extractTextFromParts(currentInput);
  if (!looksLikeNewOutfitTask(currentText) || hasExplicitRevisionSignal(currentText)) {
    return intent;
  }

  console.log('[GATEKEEPER] Adjudicated feedback_revision → wardrobe_outfit (new outfit task)');
  return {
    ...intent,
    request_type: 'wardrobe_outfit',
    selected_outfit_id: '',
    special_requests: intent.special_requests.trim() || currentText,
  };
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
    const withAnchor = resolveWardrobeAnchorIdFromHistory(normalized, history, currentText);
    normalized.anchor_wardrobe_id = withAnchor.anchor_wardrobe_id;
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
