import { Content, Part } from '@google/genai';

export type OutfitRequestType = 'wardrobe_outfit' | 'purchase_pairing' | 'feedback_revision';

export type AnchorSlot = 'top' | 'bottom' | 'dress' | 'shoes' | 'outerwear' | 'accessory';

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
  occasion: string;
  style_preference: string;
  special_requests: string;
  request_type: OutfitRequestType;
  anchor_item_summary: string;
  anchor_slot: AnchorSlot | '';
  anchor_item_image_data?: AnchorItemImageData;
}

export const DEFAULT_GATEKEEPER_INTENT: GatekeeperIntent = {
  weather: '',
  occasion: '',
  style_preference: '日常休闲',
  special_requests: '',
  request_type: 'wardrobe_outfit',
  anchor_item_summary: '',
  anchor_slot: '',
};

const PURCHASE_PAIRING_PATTERN =
  /想买|打算买|准备买|考虑买|购入|购买|入手|要不要买|这件.*(搭|配)|这副|这个.*(搭|配)|能搭|搭配.*(衣橱|衣柜|衣服)|衣橱.*(搭|配)|用.*衣橱.*搭/i;

const ACCESSORY_ANCHOR_PATTERN =
  /耳环|耳钉|耳坠|项链|颈链|手链|手镯|戒指|吊坠|胸针|发夹|发饰|手表|腰带|皮带|围巾|丝巾|帽子|贝雷帽|棒球帽|手提包|单肩包|斜挎包|墨镜|眼镜|配饰|choker|earring|necklace|bracelet|ring|pendant|scarf|belt|handbag/i;

const CASUAL_OCCASION_PATTERN = /平时|日常|百搭|通勤|上班|都可以穿|随便穿/i;

const FEEDBACK_REVISION_PATTERN =
  /第一套|第二套|上一套|刚才|太正式|太休闲|换成|不要.*色|改一下|不太喜欢/i;

export function isPurchasePairingIntent(intent: GatekeeperIntent): boolean {
  return intent.request_type === 'purchase_pairing';
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

export function detectRequestTypeFromText(text: string): OutfitRequestType {
  if (FEEDBACK_REVISION_PATTERN.test(text)) return 'feedback_revision';
  if (PURCHASE_PAIRING_PATTERN.test(text)) return 'purchase_pairing';
  return 'wardrobe_outfit';
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

/** Infer anchor slot from item description when Gatekeeper mislabels accessories as top. */
export function inferAnchorSlotFromSummary(summary: string): AnchorSlot | '' {
  const text = summary.trim();
  if (!text) return '';
  if (ACCESSORY_ANCHOR_PATTERN.test(text)) return 'accessory';
  if (/连衣裙|裙装|one.?piece|dress/i.test(text)) return 'dress';
  if (/裤|裙(?!链)|jeans|trousers|pants|shorts/i.test(text)) return 'bottom';
  if (/鞋|靴|sneaker|loafer|heel|boot/i.test(text)) return 'shoes';
  if (/外套|夹克|风衣|大衣|jacket|coat|cardigan/i.test(text)) return 'outerwear';
  if (/衬衫|上衣|T恤|针织|背心|blouse|top|tee/i.test(text)) return 'top';
  return '';
}

export function correctAnchorSlot(intent: GatekeeperIntent, contextText = ''): GatekeeperIntent {
  if (!isPurchasePairingIntent(intent)) return intent;

  const blob = `${intent.anchor_item_summary} ${contextText}`.trim();
  const inferred = inferAnchorSlotFromSummary(blob);
  if (inferred && intent.anchor_slot !== inferred) {
    console.warn(
      `[INTENT] Correcting anchor_slot: ${intent.anchor_slot || '(empty)'} → ${inferred} (${blob.slice(0, 40)}...)`
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
  return merged;
}

/** 从 Gatekeeper 已提取的 intent 读取锚定单品（不再二次调模型） */
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

export function buildPurchasePairingSpecialRequest(anchorSummary: string): string {
  const anchor = anchorSummary.trim() || '用户上传/提及的待购单品';
  return `用户待购单品（${anchor}）需作为搭配锚点，从衣橱中选取互补单品与之搭配`;
}

export function enrichIntentFromContext(
  intent: GatekeeperIntent,
  history: Content[],
  currentInput: Part[]
): GatekeeperIntent {
  const contextText = `${extractUserTextFromHistory(history)}\n${extractTextFromParts(currentInput)}`.trim();
  const hasChatClothingImage = collectImageParts(history, currentInput).length > 0;
  const normalized = normalizeGatekeeperIntent(intent);

  if (normalized.request_type === 'wardrobe_outfit') {
    const detected = detectRequestTypeFromText(contextText);
    if (detected === 'purchase_pairing' || (hasChatClothingImage && /搭|配|买|这件/.test(contextText))) {
      normalized.request_type = 'purchase_pairing';
    } else if (detected === 'feedback_revision') {
      normalized.request_type = 'feedback_revision';
    }
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

  return normalized;
}

export const PURCHASE_PAIRING_ANCHOR_FOLLOWUP =
  '方便描述一下您想搭配的单品吗？或者再发一张清晰的服装图片～';

export const WARDROBE_OCCASION_FOLLOWUP =
  '请问您打算在什么场合穿呢？例如上班通勤、约会或日常休闲～';

export function isPurchasePairingAnchorReady(intent: GatekeeperIntent): boolean {
  return (
    isPurchasePairingIntent(intent) &&
    Boolean(intent.anchor_item_summary.trim()) &&
    Boolean(intent.anchor_slot)
  );
}

/** 硬校验放行条件，防止 LLM 误标 is_complete 导致 purchase_pairing 静默降级 */
export function finalizeGatekeeperResult(input: {
  extracted_intent: GatekeeperIntent;
  followup_questions?: string[];
}): {
  is_complete: boolean;
  extracted_intent: GatekeeperIntent;
  followup_questions: string[];
} {
  const intent = normalizeGatekeeperIntent(input.extracted_intent);
  const modelFollowups = input.followup_questions?.filter((q) => q.trim()) ?? [];

  if (intent.request_type === 'feedback_revision') {
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
    return {
      is_complete: false,
      extracted_intent: intent,
      followup_questions: modelFollowups.length > 0 ? modelFollowups : [WARDROBE_OCCASION_FOLLOWUP],
    };
  }

  return { is_complete: true, extracted_intent: intent, followup_questions: [] };
}
