import { ReadableStreamDefaultController } from 'stream/web';

/**
 * 向客户端发送一个 Server-Sent Event (SSE)。
 * @param controller - ReadableStream 的控制器。
 * @param eventName - 事件名称。
 * @param data - 要发送的数据对象。
 */
export function sendEvent(controller: ReadableStreamDefaultController, eventName: string, data: object) {
  if (controller.desiredSize === null) {
    console.warn(`[CONTROLLER_LOG] 事件 '${eventName}' 被阻止，因为控制器已经关闭。`);
    return;
  }
  try {
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode(`event: ${eventName}\n`));
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  } catch (e) {
    console.error(`[CONTROLLER_LOG] 发送事件 '${eventName}' 失败:`, e);
  }
}

/**
 * 安全地完成并关闭数据流。
 * @param controller - ReadableStream 的控制器。
 * @param pendingImageTasks - 等待完成的后台图片生成任务列表。
 */
export async function handleStreamCompletion(
  controller: ReadableStreamDefaultController,
  pendingImageTasks: Promise<void>[]
) {
  console.log("[CONTROLLER_LOG] 数据流准备完成。等待所有后台任务结束...");
  try {
    await Promise.all(pendingImageTasks);
    console.log("[CONTROLLER_LOG] 所有后台任务已完成。");
  } catch (e) {
    console.error("[CONTROLLER_LOG] 等待后台任务时发生错误:", e);
  } finally {
    console.log("[CONTROLLER_LOG] 发送 'stream_end' 事件并关闭控制器。");
    sendEvent(controller, 'stream_end', { message: '所有内容已加载完毕' });
    if (controller.desiredSize !== null) {
      try {
        controller.close();
      } catch (e) {
        console.warn("[CONTROLLER_LOG] 关闭控制器时发生错误（可能已被关闭）:", e);
      }
    }
  }
}

/**
 * 处理流处理过程中的错误。
 * @param controller - ReadableStream 的控制器。
 * @param pendingImageTasks - 后台任务列表，用于最终的清理。
 * @param error - 捕获到的错误对象。
 * @param context - 错误发生的上下文描述。
 */
export function handleStreamError(
  controller: ReadableStreamDefaultController,
  pendingImageTasks: Promise<void>[],
  error: unknown,
  context: string
) {
  console.error(`后端日志：在 [${context}] 中发生错误:`, error);
  sendEvent(controller, 'error', { message: `处理您的请求时发生意外错误: ${context}` });
  
  // 3. 直接、安全地关闭控制器，不再调用 handleStreamCompletion
  if (controller.desiredSize !== null) {
    try {
      controller.close();
      console.log(`[CONTROLLER_LOG] 在错误处理后关闭控制器。`);
    } catch (e) {
      console.warn("[CONTROLLER_LOG] 在错误处理中关闭控制器失败（可能已被关闭）:", e);
    }
  }
}
