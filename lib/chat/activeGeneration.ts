/**
 * 同 Tab 同时只保留一条 generate 流。
 * beginGeneration 会 abort 上一条；回调里用 generationId 判断是否仍是当前轮。
 */

let nextGenerationId = 1;
let activeGenerationId = 0;
let activeController: AbortController | null = null;
let activeAiMessageId: string | null = null;

export function getActiveGenerationId(): number {
  return activeGenerationId;
}

export function getActiveAiMessageId(): string | null {
  return activeAiMessageId;
}

export function setActiveAiMessageId(messageId: string | null): void {
  if (messageId) activeAiMessageId = messageId;
}

export function isCurrentGeneration(generationId: number): boolean {
  return generationId === activeGenerationId;
}

/** abort 上一轮并开新 controller；返回本轮 id 与 signal。 */
export function beginGeneration(): { generationId: number; signal: AbortSignal } {
  if (activeController && !activeController.signal.aborted) {
    activeController.abort(new DOMException('Superseded by newer message', 'AbortError'));
  }
  const controller = new AbortController();
  activeController = controller;
  activeAiMessageId = null;
  activeGenerationId = nextGenerationId++;
  return { generationId: activeGenerationId, signal: controller.signal };
}

/** 仅当仍是当前轮时清句柄（避免旧流 finally 清掉新轮）。 */
export function endGeneration(generationId: number): void {
  if (generationId !== activeGenerationId) return;
  activeController = null;
  activeAiMessageId = null;
}

/** 测试用：重置模块状态 */
export function resetActiveGenerationForTests(): void {
  if (activeController && !activeController.signal.aborted) {
    activeController.abort(new DOMException('test reset', 'AbortError'));
  }
  activeController = null;
  activeAiMessageId = null;
  activeGenerationId = 0;
  nextGenerationId = 1;
}
