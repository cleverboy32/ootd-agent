/**
 * 同一 conversationId 同时只跑一条主 generate。
 * 新请求入场时 abort 本机旧 AbortController，并配合 DB generating → cancelled。
 * 进程内 Map（与 shutdown in-flight 同约束；跨实例靠前端 abort 旧 SSE）。
 */
import { discardGenerationFanoutByConversation } from '@/server/lifecycle/generationFanout';
import { createSupersededAbortError } from '@/server/utils/abort';

interface ConversationGenerationEntry {
  inFlightId: string;
  abortController: AbortController;
}

const byConversation = new Map<string, ConversationGenerationEntry>();

/** 若该会话已有生成，abort 并摘掉索引。返回被超车的 inFlightId（若有）。 */
export function supersedeConversationGeneration(conversationId: string): string | null {
  const existing = byConversation.get(conversationId);
  discardGenerationFanoutByConversation(conversationId);
  if (!existing) return null;

  byConversation.delete(conversationId);
  if (!existing.abortController.signal.aborted) {
    existing.abortController.abort(createSupersededAbortError());
  }
  return existing.inFlightId;
}

export function registerConversationGeneration(
  conversationId: string,
  inFlightId: string,
  abortController: AbortController
): void {
  byConversation.set(conversationId, { inFlightId, abortController });
}

/** 仅当仍是本请求登记的 entry 时删除，避免新请求被旧 finally 清掉。 */
export function unregisterConversationGeneration(
  conversationId: string,
  inFlightId: string
): void {
  const current = byConversation.get(conversationId);
  if (current?.inFlightId === inFlightId) {
    byConversation.delete(conversationId);
  }
}

export function resetConversationGenerationForTests(): void {
  for (const entry of byConversation.values()) {
    if (!entry.abortController.signal.aborted) {
      entry.abortController.abort(createSupersededAbortError());
    }
  }
  byConversation.clear();
}

export function getConversationGenerationCountForTests(): number {
  return byConversation.size;
}
