import { Part, Schema, Type } from '@google/genai';
import { llmGenerate } from '@/server/services/llm/client';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { urlToGenerativePart } from '@/server/utils/image';
import {
  buildPurchasePairingSpecialRequest,
  type AnchorSlot,
  type GatekeeperIntent,
} from '../intent';

const ANCHOR_SLOTS = new Set<AnchorSlot>(['top', 'bottom', 'dress', 'shoes', 'outerwear', 'accessory']);
const PLACEHOLDER_SUMMARY = '用户上传的待购单品';
/** 拿掉图片就不知道要搭哪一件 */
const IMAGE_DEICTIC = /这[件个张款条双副]|帮我(?:搭|配)|搭一下|搭配一下/;

export const NOT_A_GARMENT_REPLY = '这张图不是衣服，上传一件衣服的照片，我再帮你搭。';
export const IGNORED_UPLOAD_NOTE = '附带的图片不是衣服，这套按你的文字来搭。';

export const UPLOAD_GARMENT_OUTFIT_ADDENDUM = `
【上传单品照片】
- 附带照片的单品必须原样进入每一套方案，id 为 new_item。
- name 和 description 只复述给出的那一句身份。禁止添加照片里没有的领型、门襟、裤型、长短、分割或图案。
- 没有照片的新品仍按文字写 description。
`;

const UPLOAD_VISION_INSTRUCTION = `
你只判断用户上传的图里有没有要穿上身的服装或配饰。
每张图单独看。风景、截图、表情、海报，以及没有单独展示服装的人物照片，不要列入。
列入的每件只写槽位和一句身份：颜色和品类，可以加上一项能直接看见的结构。身份必须是这张图里占画面面积最大的那一件，不要写成背景、内搭或只占一角的单品。不要写搭配建议，不要补照片里看不清的细节。
text_depends_on_image：拿掉这些图片之后，用户的话已经说不清要搭配的对象，则为 true。话里已经有场合、天气或一套完整穿搭请求时为 false。
index 从 1 开始，对应图的序号。slot 只能是 top、bottom、dress、shoes、outerwear、accessory。
`;

const uploadVisionSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    garments: {
      type: Type.ARRAY,
      description: '可以穿上身的服装或配饰。不是衣服的图不要列入。',
      items: {
        type: Type.OBJECT,
        properties: {
          index: { type: Type.NUMBER, description: '图的序号，从 1 开始。' },
          slot: {
            type: Type.STRING,
            description: 'top | bottom | dress | shoes | outerwear | accessory',
          },
          identity: {
            type: Type.STRING,
            description: '一句身份：颜色和品类，可加一项能直接看见的结构。不要扩写。',
          },
        },
        required: ['index', 'slot', 'identity'],
      },
    },
    text_depends_on_image: {
      type: Type.BOOLEAN,
      description: '拿掉图片后，用户的话已经说不清要搭配的对象时为 true。',
    },
  },
  required: ['garments', 'text_depends_on_image'],
};

export interface SeenGarment {
  /** 0-based，对应当前上传 URL 的顺序 */
  index: number;
  slot: AnchorSlot;
  identity: string;
}

export interface RememberedUploadSource {
  purchase_image_urls?: string[];
  upload_garments?: Array<{ imageUrl?: string; slot?: string; identity?: string }>;
  outfits?: Array<{
    selected_items: Array<{ id: string; name: string; layer: string; description?: string }>;
  }>;
}

function layerToAnchorSlot(layer: string): AnchorSlot | '' {
  const value = layer.trim().toLowerCase();
  if (value === 'top' || value.includes('inner') || value.includes('shirt') || value.includes('tee')) return 'top';
  if (value === 'bottom' || value.includes('bottom') || value.includes('pant') || value.includes('skirt')) return 'bottom';
  if (value === 'dress' || value.includes('dress')) return 'dress';
  if (value === 'shoes' || value.includes('shoe')) return 'shoes';
  if (value === 'outerwear' || value.includes('outer')) return 'outerwear';
  if (value === 'accessory' || value.includes('accessor')) return 'accessory';
  return '';
}

function garmentsFromResult(result: RememberedUploadSource): Array<{ imageUrl: string; slot: AnchorSlot; identity: string }> {
  const stored = (result.upload_garments ?? [])
    .map((item) => {
      const slot = parseSlot(item.slot ?? '') || layerToAnchorSlot(item.slot ?? '');
      const identity = item.identity?.trim() ?? '';
      const imageUrl = item.imageUrl?.trim() ?? '';
      if (!imageUrl || !slot || !identity) return null;
      return { imageUrl, slot, identity };
    })
    .filter((item): item is { imageUrl: string; slot: AnchorSlot; identity: string } => Boolean(item));
  if (stored.length > 0) return stored;

  const urls = (result.purchase_image_urls ?? []).map((url) => url.trim()).filter(Boolean);
  const outfits = result.outfits ?? [];
  if (urls.length === 0 || outfits.length === 0) return [];
  const sharedNames = new Set(
    outfits[0].selected_items
      .filter((item) => item.id === 'new_item' && item.name.trim())
      .map((item) => item.name)
      .filter((name) => outfits.every((outfit) => outfit.selected_items.some((item) => item.name === name)))
  );
  const shared = outfits[0].selected_items.filter((item) => sharedNames.has(item.name));
  const singleOutfit = outfits.length === 1;
  const usable = singleOutfit ? (shared.length === urls.length ? shared : []) : shared.length === urls.length ? shared : [];
  return usable.flatMap((item, index) => {
    const slot = layerToAnchorSlot(item.layer);
    const imageUrl = urls[index];
    const identity = item.description?.trim() || item.name.trim();
    if (!slot || !imageUrl || !identity) return [];
    return [{ imageUrl, slot, identity }];
  });
}

/**
 * 同一张上传图沿用最早一次认对的身份。后一次看走眼不能覆盖。
 * 每张图都能对上才返回，否则整组重看。
 */
export function rememberedUploadGarments(
  priorResults: RememberedUploadSource[],
  imageUrls: string[]
): SeenGarment[] | null {
  const urls = imageUrls.map((url) => url.trim()).filter(Boolean).slice(0, 4);
  if (urls.length === 0 || priorResults.length === 0) return null;
  const known = new Map<string, { slot: AnchorSlot; identity: string }>();
  for (const result of priorResults) {
    for (const item of garmentsFromResult(result)) {
      if (!known.has(item.imageUrl)) known.set(item.imageUrl, { slot: item.slot, identity: item.identity });
    }
  }
  const garments: SeenGarment[] = [];
  for (let index = 0; index < urls.length; index += 1) {
    const hit = known.get(urls[index]);
    if (!hit) return null;
    garments.push({ index, slot: hit.slot, identity: hit.identity });
  }
  return garments;
}

export type UploadVisionDecision =
  | { type: 'reply'; reply: string }
  | { type: 'continue'; intent: GatekeeperIntent; ignoredUploadNote: string };

export function textNeedsUpload(userMessage: string, modelSays: boolean): boolean {
  return modelSays || IMAGE_DEICTIC.test(userMessage);
}

/** 话指向上传图、Gatekeeper 又停在追问时，放给搭配师看图。 */
export function releaseDeicticUpload(
  intent: GatekeeperIntent,
  imageCount: number,
  userMessage: string
): GatekeeperIntent {
  if (imageCount <= 0 || intent.request_type !== 'clarify') return intent;
  if (!textNeedsUpload(userMessage, false)) return intent;
  return {
    ...intent,
    request_type: 'purchase_pairing',
    purchase_vision_pending: true,
    occasion: intent.occasion.trim() || '日常百搭',
  };
}

export function shouldInspectUploads(requestType: string, imageCount: number): boolean {
  if (imageCount <= 0) return false;
  return (
    requestType === 'wardrobe_outfit' ||
    requestType === 'purchase_pairing' ||
    requestType === 'outfit_redo'
  );
}

export function latestSessionUploadUrls(
  items: Array<{ messageId?: string; imageUrl: string }> | undefined
): string[] {
  const cleaned = (items ?? [])
    .map((item) => ({ messageId: item.messageId?.trim() ?? '', imageUrl: item.imageUrl.trim() }))
    .filter((item) => item.imageUrl);
  if (cleaned.length === 0) return [];
  const latestMessageId = [...cleaned].reverse().find((item) => item.messageId)?.messageId ?? '';
  const group = latestMessageId ? cleaned.filter((item) => item.messageId === latestMessageId) : cleaned;
  return group.map((item) => item.imageUrl).slice(0, 4);
}

/** 本轮没新图、但是整套重做时，把最近一次一起上传的图交给搭配师。 */
export function resolveStylistUploadUrls(
  currentImageUrls: string[] | undefined,
  intent: { request_type: string; purchase_vision_pending?: boolean },
  sessionItems: Array<{ messageId?: string; imageUrl: string }> | undefined
): string[] {
  const current = (currentImageUrls ?? []).map((url) => url.trim()).filter(Boolean);
  if (current.length > 0) return current.slice(0, 4);
  const reusePrevious =
    intent.request_type === 'outfit_redo' ||
    (intent.request_type === 'purchase_pairing' && Boolean(intent.purchase_vision_pending));
  if (!reusePrevious) return [];
  return latestSessionUploadUrls(sessionItems);
}

function parseSlot(value: string): AnchorSlot | '' {
  const slot = value.trim() as AnchorSlot;
  return ANCHOR_SLOTS.has(slot) ? slot : '';
}

function keepGarments(garments: SeenGarment[], imageCount: number): SeenGarment[] {
  const used = new Set<number>();
  const kept: SeenGarment[] = [];
  for (const item of garments) {
    if (item.index < 0 || item.index >= imageCount || used.has(item.index)) continue;
    if (!item.slot || !item.identity.trim()) continue;
    used.add(item.index);
    kept.push({ ...item, identity: item.identity.trim() });
    if (kept.length >= 4) break;
  }
  return kept;
}

/** 模型输出规范成 0-based、槽位合法、身份非空、下标不重复。 */
export function normalizeSeenGarments(
  raw: Array<{ index?: number; slot?: string; identity?: string }>,
  imageCount: number
): SeenGarment[] {
  const used = new Set<number>();
  const garments: SeenGarment[] = [];
  for (const item of raw) {
    const reported = Number(item.index);
    if (!Number.isFinite(reported)) continue;
    const index = reported >= 1 ? reported - 1 : reported;
    if (index < 0 || index >= imageCount || used.has(index)) continue;
    const slot = parseSlot(item.slot ?? '');
    const identity = item.identity?.trim() ?? '';
    if (!slot || !identity) continue;
    used.add(index);
    garments.push({ index, slot, identity });
    if (garments.length >= 4) break;
  }
  return garments;
}

function sessionIdForUrl(intent: GatekeeperIntent, url: string, onlyOne: boolean): string {
  const listed = intent.purchase_items?.find((item) => item.imageUrl === url)?.session_item_id?.trim();
  if (listed) return listed;
  if ((onlyOne || intent.anchor_image_url === url) && intent.session_item_id?.trim()) {
    return intent.session_item_id.trim();
  }
  return '';
}

function clearPurchaseAnchor(intent: GatekeeperIntent): GatekeeperIntent {
  const special = intent.special_requests.trim();
  const dropSpecial = !special || special.includes('需作为搭配锚点') || special.includes(PLACEHOLDER_SUMMARY);
  return {
    ...intent,
    request_type: 'wardrobe_outfit',
    anchor_item_summary: '',
    anchor_slot: '',
    anchor_image_url: '',
    anchor_item_image_data: undefined,
    purchase_items: [],
    purchase_vision_pending: false,
    session_item_id: '',
    special_requests: dropSpecial ? '' : intent.special_requests,
  };
}

/**
 * 看图结果如何进入搭配。没有衣服且这句话离不开图：直接回文字。
 * 没有衣服但文字本身已是穿搭请求：丢掉图，按文字继续。有衣服：只留下这些件。
 */
export function decideUploadVision(input: {
  intent: GatekeeperIntent;
  imageUrls: string[];
  garments: SeenGarment[];
  textDependsOnImage: boolean;
  userMessage: string;
}): UploadVisionDecision {
  const urls = input.imageUrls.filter((url) => url.trim()).slice(0, 4);
  if (!shouldInspectUploads(input.intent.request_type, urls.length)) {
    return { type: 'continue', intent: input.intent, ignoredUploadNote: '' };
  }

  const garments = keepGarments(input.garments, urls.length);
  if (garments.length === 0) {
    if (input.intent.request_type === 'outfit_redo') {
      return { type: 'continue', intent: clearPurchaseAnchor(input.intent), ignoredUploadNote: '' };
    }
    if (textNeedsUpload(input.userMessage, input.textDependsOnImage)) {
      return { type: 'reply', reply: NOT_A_GARMENT_REPLY };
    }
    const intent =
      input.intent.request_type === 'purchase_pairing' ? clearPurchaseAnchor(input.intent) : input.intent;
    return { type: 'continue', intent, ignoredUploadNote: IGNORED_UPLOAD_NOTE };
  }

  const onlyOne = garments.length === 1;
  const purchase_items = garments.map((item) => ({
    session_item_id: sessionIdForUrl(input.intent, urls[item.index], onlyOne),
    summary: item.identity,
    slot: item.slot,
    imageUrl: urls[item.index],
  }));
  const first = purchase_items[0];
  const identities = purchase_items.map((item) => item.summary).join('、');
  const previousSpecial = input.intent.special_requests.trim();
  const replaceSpecial =
    !previousSpecial ||
    previousSpecial.includes('需作为搭配锚点') ||
    previousSpecial.includes(PLACEHOLDER_SUMMARY);

  return {
    type: 'continue',
    ignoredUploadNote: '',
    intent: {
      ...input.intent,
      request_type: 'purchase_pairing',
      purchase_items,
      anchor_item_summary: first.summary,
      anchor_slot: first.slot,
      session_item_id: first.session_item_id,
      anchor_image_url: first.imageUrl,
      purchase_vision_pending: false,
      occasion: input.intent.occasion.trim() || '日常百搭',
      special_requests: replaceSpecial
        ? buildPurchasePairingSpecialRequest(identities)
        : input.intent.special_requests,
    },
  };
}

function inlineImageParts(parts: Part[] | undefined): Part[] {
  return (parts ?? []).filter((part) => Boolean(part.inlineData?.data));
}

export async function identifyUploadGarments(
  imageUrls: string[],
  userMessage: string,
  signal?: AbortSignal,
  existingParts?: Part[]
): Promise<{ garments: SeenGarment[]; textDependsOnImage: boolean }> {
  const urls = imageUrls.filter((url) => url.trim()).slice(0, 4);
  const cached = inlineImageParts(existingParts);
  const parts: Part[] = [];
  for (let index = 0; index < urls.length; index += 1) {
    parts.push({ text: `图${index + 1}` });
    if (cached[index]?.inlineData) {
      parts.push(cached[index]);
      continue;
    }
    try {
      parts.push(await urlToGenerativePart(urls[index]));
    } catch (error) {
      console.warn('[STYLIST_AGENT] upload image skipped:', urls[index].slice(0, 80), error);
    }
  }

  const attached = parts.some((part) => part.inlineData?.data);
  if (!attached) {
    return { garments: [], textDependsOnImage: textNeedsUpload(userMessage, false) };
  }

  parts.push({
    text: `用户原话：${userMessage.trim() || '（没有文字）'}`,
  });

  const response = await withRetryOn429(
    () =>
      llmGenerate({
        model: AGENT_MODELS.stylistVision,
        contents: [{ role: 'user', parts }],
        systemInstruction: UPLOAD_VISION_INSTRUCTION,
        temperature: 0,
        jsonSchema: uploadVisionSchema,
        signal,
      }),
    { label: 'Stylist upload vision' }
  );

  if (!response.text) {
    throw new Error('Empty upload vision response from Stylist');
  }

  const parsed = JSON.parse(response.text) as {
    garments?: Array<{ index?: number; slot?: string; identity?: string }>;
    text_depends_on_image?: boolean;
  };
  const garments = normalizeSeenGarments(parsed.garments ?? [], urls.length);
  console.log('[STYLIST_AGENT] Upload vision:', garments.map((item) => item.identity).join(' | ') || '(no garment)');
  return {
    garments,
    textDependsOnImage: Boolean(parsed.text_depends_on_image),
  };
}
