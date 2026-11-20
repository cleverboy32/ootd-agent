/**
 * 主 generate 的 SSE 扇出 + 全程实录 buffer，供刷新后续流（resume）。
 * 进程内 Map；超车 discard；complete 后短延迟清理。
 */
import { enqueueSseEvent } from '@/server/utils/stream-helpers';

export type FanoutEvent = { eventName: string; data: object };

const MAX_BUFFER_EVENTS = 400;
const MAX_BUFFER_CHARS = 200_000;
const COMPLETE_TTL_MS = 30_000;

export interface FanoutEntry {
  conversationId: string;
  messageId?: string;
  buffer: FanoutEvent[];
  bufferChars: number;
  subscribers: Set<ReadableStreamDefaultController>;
  completed: boolean;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

const byConversation = new Map<string, FanoutEntry>();
const byMessageId = new Map<string, FanoutEntry>();

function estimateChars(event: FanoutEvent): number {
  try {
    return JSON.stringify(event).length;
  } catch {
    return 64;
  }
}

function compressBuffer(entry: FanoutEntry): void {
  if (entry.buffer.length <= MAX_BUFFER_EVENTS && entry.bufferChars <= MAX_BUFFER_CHARS) {
    return;
  }

  let metadata: FanoutEvent | undefined;
  let text = '';
  const recentProgress: FanoutEvent[] = [];
  const tails: FanoutEvent[] = [];

  for (const ev of entry.buffer) {
    if (ev.eventName === 'metadata') {
      metadata = ev;
      continue;
    }
    if (ev.eventName === 'text_chunk') {
      const chunk = (ev.data as { text?: unknown }).text;
      if (typeof chunk === 'string') text += chunk;
      continue;
    }
    if (ev.eventName === 'progress') {
      recentProgress.push(ev);
      if (recentProgress.length > 12) recentProgress.shift();
      continue;
    }
    if (
      ev.eventName === 'image_generated' ||
      ev.eventName === 'image_generation_failed' ||
      ev.eventName === 'image_credits_required' ||
      ev.eventName === 'wardrobe_candidates' ||
      ev.eventName === 'stream_end' ||
      ev.eventName === 'error'
    ) {
      tails.push(ev);
      if (tails.length > 40) tails.shift();
    }
  }

  const next: FanoutEvent[] = [];
  if (metadata) next.push(metadata);
  if (text) next.push({ eventName: 'text_chunk', data: { text } });
  next.push(...recentProgress, ...tails);
  entry.buffer = next;
  entry.bufferChars = next.reduce((sum, ev) => sum + estimateChars(ev), 0);
}

function indexEntry(entry: FanoutEntry): void {
  byConversation.set(entry.conversationId, entry);
  if (entry.messageId) byMessageId.set(entry.messageId, entry);
}

function unindexEntry(entry: FanoutEntry): void {
  if (byConversation.get(entry.conversationId) === entry) {
    byConversation.delete(entry.conversationId);
  }
  if (entry.messageId && byMessageId.get(entry.messageId) === entry) {
    byMessageId.delete(entry.messageId);
  }
}

/** 开一场可恢复生成；同会话已有则先 discard。 */
export function openGenerationFanout(conversationId: string): FanoutEntry {
  discardGenerationFanoutByConversation(conversationId);
  const entry: FanoutEntry = {
    conversationId,
    buffer: [],
    bufferChars: 0,
    subscribers: new Set(),
    completed: false,
  };
  indexEntry(entry);
  return entry;
}

export function attachFanoutMessageId(conversationId: string, messageId: string): void {
  const entry = byConversation.get(conversationId);
  if (!entry) return;
  if (entry.messageId && entry.messageId !== messageId) {
    byMessageId.delete(entry.messageId);
  }
  entry.messageId = messageId;
  byMessageId.set(messageId, entry);
}

export function getFanoutByMessageId(messageId: string): FanoutEntry | undefined {
  return byMessageId.get(messageId);
}

export function getFanoutByConversationId(conversationId: string): FanoutEntry | undefined {
  return byConversation.get(conversationId);
}

export function publishGenerationEvent(
  conversationId: string,
  eventName: string,
  data: object
): void {
  const entry = byConversation.get(conversationId);
  if (!entry) return;

  const event: FanoutEvent = { eventName, data };
  if (eventName !== 'ping') {
    entry.buffer.push(event);
    entry.bufferChars += estimateChars(event);
    compressBuffer(entry);
  }

  for (const controller of [...entry.subscribers]) {
    enqueueSseEvent(controller, eventName, data);
  }
}

function replayAndSubscribe(
  entry: FanoutEntry,
  controller: ReadableStreamDefaultController
): void {
  for (const ev of entry.buffer) {
    enqueueSseEvent(controller, ev.eventName, ev.data);
  }
  if (entry.completed) {
    try {
      if (controller.desiredSize !== null) controller.close();
    } catch {
      /* already closed */
    }
    return;
  }
  entry.subscribers.add(controller);
}

/** 主 SSE 在 messageId 尚未就绪时按会话订阅。 */
export function subscribeGenerationFanoutByConversation(
  conversationId: string,
  controller: ReadableStreamDefaultController
): boolean {
  const entry = byConversation.get(conversationId);
  if (!entry) return false;
  replayAndSubscribe(entry, controller);
  return true;
}

/** resume：先完整 replay，再收 live。 */
export function subscribeGenerationFanout(
  messageId: string,
  controller: ReadableStreamDefaultController
): boolean {
  const entry = byMessageId.get(messageId);
  if (!entry) return false;
  replayAndSubscribe(entry, controller);
  return true;
}

export function unsubscribeGenerationFanout(
  conversationId: string,
  controller: ReadableStreamDefaultController
): void {
  const entry = byConversation.get(conversationId);
  entry?.subscribers.delete(controller);
}

export function unsubscribeGenerationFanoutByMessageId(
  messageId: string,
  controller: ReadableStreamDefaultController
): void {
  const entry = byMessageId.get(messageId);
  entry?.subscribers.delete(controller);
}

export function discardGenerationFanoutByConversation(conversationId: string): void {
  const entry = byConversation.get(conversationId);
  if (!entry) return;
  if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer);
  for (const controller of [...entry.subscribers]) {
    try {
      if (controller.desiredSize !== null) controller.close();
    } catch {
      /* already closed */
    }
  }
  entry.subscribers.clear();
  entry.buffer = [];
  entry.bufferChars = 0;
  unindexEntry(entry);
  console.log(`[GENERATION_FANOUT] discarded conversationId=${conversationId}`);
}

/**
 * 标记本场结束并关闭仍连着的 SSE；TTL 后清 buffer。
 * 必须用 open 时拿到的 entry 引用，避免超车后误 complete 新场。
 */
export function completeGenerationFanoutEntry(entry: FanoutEntry): void {
  if (byConversation.get(entry.conversationId) !== entry) return;
  entry.completed = true;
  for (const controller of [...entry.subscribers]) {
    try {
      if (controller.desiredSize !== null) controller.close();
    } catch {
      /* already closed */
    }
  }
  entry.subscribers.clear();
  if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer);
  entry.cleanupTimer = setTimeout(() => {
    if (byConversation.get(entry.conversationId) === entry) {
      unindexEntry(entry);
    }
    entry.buffer = [];
    entry.bufferChars = 0;
  }, COMPLETE_TTL_MS);
  console.log(
    `[GENERATION_FANOUT] completed conversationId=${entry.conversationId} messageId=${entry.messageId ?? '-'}`
  );
}

export function completeGenerationFanout(conversationId: string): void {
  const entry = byConversation.get(conversationId);
  if (!entry) return;
  completeGenerationFanoutEntry(entry);
}

export function resetGenerationFanoutForTests(): void {
  for (const entry of byConversation.values()) {
    if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer);
    entry.subscribers.clear();
  }
  byConversation.clear();
  byMessageId.clear();
}

export function getFanoutBufferForTests(conversationId: string): FanoutEvent[] {
  return [...(byConversation.get(conversationId)?.buffer ?? [])];
}

export function getFanoutSubscriberCountForTests(conversationId: string): number {
  return byConversation.get(conversationId)?.subscribers.size ?? 0;
}
