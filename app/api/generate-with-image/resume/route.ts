import { NextRequest } from 'next/server';
import prismadb from '@/server/db';
import {
  getFanoutByMessageId,
  subscribeGenerationFanout,
  unsubscribeGenerationFanoutByMessageId,
} from '@/server/lifecycle/generationFanout';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

/**
 * 刷新后续流：按 messageId 订阅 generationFanout（先 replay 全程 buffer，再收 live）。
 */
export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Client ID is required' }), { status: 400 });
  }

  const messageId = req.nextUrl.searchParams.get('messageId')?.trim();
  if (!messageId) {
    return new Response(JSON.stringify({ error: 'messageId is required' }), { status: 400 });
  }

  const message = await prismadb.message.findFirst({
    where: {
      id: messageId,
      conversation: { userId },
    },
    select: { id: true, status: true, conversationId: true },
  });

  if (!message) {
    return new Response(JSON.stringify({ error: 'Message not found' }), { status: 404 });
  }

  if (message.status !== 'generating') {
    console.log(
      `[GENERATE_RESUME] terminal status=${message.status} messageId=${messageId}`
    );
    return new Response(JSON.stringify({ status: message.status }), { status: 409 });
  }

  const fanout = getFanoutByMessageId(messageId);
  if (!fanout) {
    // 他机生成或本机 buffer 已丢：前端短轮询兜底
    console.log(`[GENERATE_RESUME] no fanout messageId=${messageId} (404)`);
    return new Response(JSON.stringify({ error: 'Fanout unavailable' }), { status: 404 });
  }

  console.log(
    `[GENERATE_RESUME] subscribe messageId=${messageId} conversationId=${message.conversationId} buffer=${fanout.buffer.length}`
  );

  let streamController: ReadableStreamDefaultController | null = null;

  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;
      const ok = subscribeGenerationFanout(messageId, controller);
      if (!ok) {
        controller.enqueue(
          new TextEncoder().encode(
            `event: error\ndata: ${JSON.stringify({ message: 'Fanout unavailable' })}\n\n`
          )
        );
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
    cancel(reason) {
      if (streamController) {
        unsubscribeGenerationFanoutByMessageId(messageId, streamController);
      }
      console.log(
        `[GENERATE_RESUME] client disconnect messageId=${messageId}:`,
        reason instanceof Error ? reason.message : reason
      );
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
