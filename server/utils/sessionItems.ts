import type { Message } from '@/server/types/message';

/** 本会话从用户消息提取的待购上传图（conversation 维，派生自历史） */
export interface SessionPurchaseItem {
  /** 窗口内稳定序号，如 si_1 */
  id: string;
  messageId: string;
  imageUrl: string;
  /** 同条消息文本，供 Gate 指代 */
  hintText: string;
}

function extractImageUrlFromMessage(message: Message): string | undefined {
  if (!Array.isArray(message.content)) {
    return typeof message.imageUrl === 'string' && message.imageUrl.trim()
      ? message.imageUrl.trim()
      : undefined;
  }
  for (const part of message.content) {
    if (part?.type === 'image' && typeof part.content === 'string' && part.content.trim()) {
      return part.content.trim();
    }
  }
  if (typeof message.imageUrl === 'string' && message.imageUrl.trim()) {
    return message.imageUrl.trim();
  }
  return undefined;
}

function extractHintTextFromMessage(message: Message): string {
  if (!Array.isArray(message.content)) return '';
  const texts = message.content
    .filter((p) => p?.type === 'text' && typeof p.content === 'string')
    .map((p) => (p.content as string).trim())
    .filter(Boolean);
  return texts.join(' ').slice(0, 120);
}

/**
 * 从已加载的会话消息中抽出用户上传待购图（不额外打库）。
 * 仅处理 role=user；顺序与消息时间序一致。
 */
export function extractSessionItemsFromMessages(messages: Message[]): SessionPurchaseItem[] {
  const items: SessionPurchaseItem[] = [];
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const imageUrl = extractImageUrlFromMessage(message);
    if (!imageUrl) continue;
    items.push({
      id: `si_${items.length + 1}`,
      messageId: message.id,
      imageUrl,
      hintText: extractHintTextFromMessage(message),
    });
  }
  return items;
}

/** 本轮请求图若不在清单中则追加（覆盖「消息尚未入库」边界） */
export function mergeCurrentImageIntoSessionItems(
  items: SessionPurchaseItem[],
  currentImageUrl?: string
): SessionPurchaseItem[] {
  const url = currentImageUrl?.trim();
  if (!url) return items;
  if (items.some((item) => item.imageUrl === url)) return items;
  return [
    ...items,
    {
      id: `si_${items.length + 1}`,
      messageId: 'current',
      imageUrl: url,
      hintText: '',
    },
  ];
}

/** 注入 Gate 的文本块（原则描述，不含死举例清单外逻辑） */
export function formatSessionItemsForGate(items: SessionPurchaseItem[]): string {
  if (items.length === 0) return '';
  const lines = items.map((item) => {
    const hint = item.hintText ? ` | ${item.hintText}` : '';
    return `- ${item.id}${hint}`;
  });
  return [
    '【会话待购单品】本会话用户上传的待购图清单（服务端从历史消息提取）。',
    'purchase_pairing 时必须填写 session_item_id 为下列之一；feedback_revision 必须填空字符串。',
    ...lines,
  ].join('\n');
}

export function findSessionItemById(
  items: SessionPurchaseItem[],
  id: string | undefined
): SessionPurchaseItem | undefined {
  const trimmed = id?.trim();
  if (!trimmed) return undefined;
  return items.find((item) => item.id === trimmed);
}

export function findSessionItemByUrl(
  items: SessionPurchaseItem[],
  imageUrl: string | undefined
): SessionPurchaseItem | undefined {
  const url = imageUrl?.trim();
  if (!url) return undefined;
  return items.find((item) => item.imageUrl === url);
}

/** 从文案中抓 si_N（Gate/用户/特殊要求里常见） */
export function extractSessionItemIdFromText(text: string): string | undefined {
  const match = text.match(/\bsi_(\d+)\b/i);
  return match ? `si_${match[1]}` : undefined;
}

/**
 * 微调时找回待购图 URL：优先文案里的 si_N，其次仅一件时兜底。
 * 用于旧 cache 尚未写入 anchor_image_url 的会话。
 */
export function resolveAnchorUrlFromSessionItems(
  items: SessionPurchaseItem[],
  contextText = ''
): string | undefined {
  if (items.length === 0) return undefined;
  const mentionedId = extractSessionItemIdFromText(contextText);
  if (mentionedId) {
    const hit = findSessionItemById(items, mentionedId);
    if (hit) return hit.imageUrl;
  }
  if (items.length === 1) return items[0].imageUrl;
  return undefined;
}

export interface PurchaseImageRef {
  url: string;
  label: string;
}

/**
 * 方案含多个 new_item 时，把会话里其它待购图也作为参考图塞进 Seedream，
 * 避免只喂当前锚点、历史待购裤/衣变成纯文案导致画丢。
 */
export function buildAdditionalPurchaseImageRefs(
  outfit: { selected_items: Array<{ id: string; name: string; layer: string }> },
  sessionItems: SessionPurchaseItem[],
  primaryAnchorUrl?: string
): PurchaseImageRef[] {
  const newItems = outfit.selected_items.filter((i) => i.id === 'new_item');
  if (newItems.length <= 1 || sessionItems.length === 0) return [];

  const primary = primaryAnchorUrl?.trim() || '';
  const used = new Set<string>();
  const refs: PurchaseImageRef[] = [];

  for (const ni of newItems) {
    const hit = sessionItems.find(
      (item) =>
        Boolean(item.imageUrl) &&
        !used.has(item.imageUrl) &&
        (namesOverlap(ni.name, item.hintText) || layerHintOverlap(ni.layer, item.hintText, ni.name))
    );
    if (!hit) continue;
    used.add(hit.imageUrl);
    // 主锚点已在 Seedream 第一张参考图，勿重复
    if (primary && hit.imageUrl === primary) continue;
    refs.push({
      url: hit.imageUrl,
      label: `${ni.name} (${ni.layer}) — session ${hit.id} purchase ref`,
    });
  }

  return refs;
}

function namesOverlap(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na) || shareSignificantToken(na, nb);
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]/g, '')
    .trim();
}

function shareSignificantToken(a: string, b: string): boolean {
  const tokens = [
    '裤',
    '裙',
    '衬衫',
    '外套',
    '皮衣',
    '鞋',
    '靴',
    '大衣',
    '卫衣',
    '夹克',
    'jeans',
    'pants',
    'jacket',
    'coat',
  ];
  return tokens.some((t) => a.includes(t) && b.includes(t));
}

function layerHintOverlap(layer: string, hint: string, name: string): boolean {
  const keywords =
    layer.includes('bottom') || layer === 'bottom'
      ? ['裤', '牛仔裤', '阔腿', '西裤', '短裤']
      : layer.includes('outer') || layer === 'outerwear'
        ? ['外套', '皮衣', '夹克', '大衣', '风衣']
        : layer.includes('top') || layer.includes('inner')
          ? ['衫', 'T恤', '上衣', '毛衣', '卫衣']
          : [];
  if (keywords.length === 0) return false;
  // 两侧都要命中品类词，避免用 new_item 自己的名字去“匹配”任意 session hint
  const nameHit = keywords.some((k) => name.includes(k));
  const hintHit = keywords.some((k) => hint.includes(k));
  return nameHit && hintHit;
}
