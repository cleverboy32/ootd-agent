import { ReadableStreamDefaultController } from 'stream/web';
import { publishGenerationEvent } from '@/server/lifecycle/generationFanout';

/** controller → conversationId：sendEvent 非 ping 时改走 fanout 全程实录 */
const fanoutBoundControllers = new WeakMap<ReadableStreamDefaultController, string>();

export function bindControllerToGenerationFanout(
  controller: ReadableStreamDefaultController,
  conversationId: string
): void {
  fanoutBoundControllers.set(controller, conversationId);
}

export function unbindControllerFromGenerationFanout(
  controller: ReadableStreamDefaultController
): void {
  fanoutBoundControllers.delete(controller);
}

/** 直接写入单个 SSE controller（fanout 内部 fan-out 用，避免递归）。 */
export function enqueueSseEvent(
  controller: ReadableStreamDefaultController,
  eventName: string,
  data: object
): void {
  if (controller.desiredSize === null) {
    return;
  }
  try {
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode(`event: ${eventName}\n`));
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ERR_INVALID_STATE') {
      return;
    }
    console.error(`[CONTROLLER_LOG] 发送事件 '${eventName}' 失败:`, e);
  }
}

/**
 * 向客户端发送一个 Server-Sent Event (SSE)。
 * 若 controller 已 bind 到 generation fanout，则写入全程 buffer 并扇出。
 * 软断开后仍保持 bind（仅 unsubscribe），保证后台 sendEvent 继续实录供 resume。
 */
export function sendEvent(
  controller: ReadableStreamDefaultController,
  eventName: string,
  data: object
): void {
  const conversationId = fanoutBoundControllers.get(controller);
  if (conversationId && eventName !== 'ping') {
    publishGenerationEvent(conversationId, eventName, data);
    return;
  }
  enqueueSseEvent(controller, eventName, data);
}

/**
 * Keep an SSE response alive while upstream work is silent (e.g. long Stylist LLM calls).
 * Returns a stop() that clears the interval; also stops when `signal` aborts.
 */
export function startSseHeartbeat(
  controller: ReadableStreamDefaultController,
  signal: AbortSignal,
  intervalMs = 15_000
): () => void {
  const tick = () => {
    if (signal.aborted || controller.desiredSize === null) {
      stop();
      return;
    }
    sendEvent(controller, 'ping', { ts: Date.now() });
  };

  const timer = setInterval(tick, intervalMs);

  const onAbort = () => stop();
  signal.addEventListener('abort', onAbort, { once: true });

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    signal.removeEventListener('abort', onAbort);
  }

  return stop;
}

/**
 * 安全地完成并关闭数据流。
 */
export async function handleStreamCompletion(
  controller: ReadableStreamDefaultController,
  pendingImageTasks: Promise<void>[]
) {
  console.log('[CONTROLLER_LOG] 数据流准备完成。等待所有后台任务结束...');
  try {
    await Promise.all(pendingImageTasks);
    console.log('[CONTROLLER_LOG] 所有后台任务已完成。');
  } catch (e) {
    console.error('[CONTROLLER_LOG] 等待后台任务时发生错误:', e);
  } finally {
    console.log("[CONTROLLER_LOG] 发送 'stream_end' 事件并关闭控制器。");
    sendEvent(controller, 'stream_end', { message: '所有内容已加载完毕' });
    if (controller.desiredSize !== null) {
      try {
        controller.close();
      } catch (e) {
        console.warn('[CONTROLLER_LOG] 关闭控制器时发生错误（可能已被关闭）:', e);
      }
    }
  }
}

/**
 * 处理流处理过程中的错误。
 */
export function handleStreamError(
  controller: ReadableStreamDefaultController,
  pendingImageTasks: Promise<void>[],
  error: unknown,
  context: string
) {
  console.error(`后端日志：在 [${context}] 中发生错误:`, error);
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'unknown';
  sendEvent(controller, 'error', {
    message: `处理您的请求时发生意外错误: ${context} — ${detail.slice(0, 240)}`,
  });

  if (controller.desiredSize !== null) {
    try {
      controller.close();
      console.log(`[CONTROLLER_LOG] 在错误处理后关闭控制器。`);
    } catch (e) {
      console.warn('[CONTROLLER_LOG] 在错误处理中关闭控制器失败（可能已被关闭）:', e);
    }
  }
}
