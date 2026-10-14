export const MESSAGE_PAGE_DEFAULT_LIMIT = 20;
export const MESSAGE_PAGE_MAX_LIMIT = 50;

export interface MessagePage<T> {
  /** 时间正序 */
  messages: T[];
  /** 本页最旧消息的 id，作为下一页的 `before`；没有更早消息时为 null */
  nextCursor: string | null;
}

export function parseMessagePageLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (Number.isNaN(parsed)) return MESSAGE_PAGE_DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), MESSAGE_PAGE_MAX_LIMIT);
}

/**
 * @param rowsDesc 按时间倒序查询、`take: limit + 1` 的结果，多出的一条只用于判断是否还有更早消息
 *
 * 有更早消息时页首对齐到 user 消息：客户端重试 AI 回复依赖「前一条即其用户消息」，
 * 页首的孤立 AI 消息会随下一页一起返回。
 */
export function buildMessagePage<T extends { id: string; role: string }>(
  rowsDesc: T[],
  limit: number,
): MessagePage<T> {
  const hasMore = rowsDesc.length > limit;
  let messages = rowsDesc.slice(0, limit).reverse();

  if (hasMore) {
    const firstUserIdx = messages.findIndex((m) => m.role === 'user');
    if (firstUserIdx > 0) messages = messages.slice(firstUserIdx);
  }

  return {
    messages,
    nextCursor: hasMore && messages.length > 0 ? messages[0].id : null,
  };
}
