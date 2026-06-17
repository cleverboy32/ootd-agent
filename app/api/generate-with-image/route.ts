import { Part } from "@google/genai";
import { NextRequest } from "next/server";
import { createImageRetryStream, createMultiAgentStream } from "./multi-agent-orchestrator";
import { urlToGenerativePart } from '@/server/utils/image';
import { resolveClientIp } from '@/server/utils/resolveClientIp';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { content, conversationId, messageId, retryOutfitId } = body;
    const text = content?.text;
    const imageUrl = content?.imageUrl;

    const clientId = req.headers.get('X-Client-ID');

    if (retryOutfitId) {
      if (!conversationId || !messageId) {
        return new Response(
          JSON.stringify({ error: 'conversationId and messageId are required for image retry' }),
          { status: 400 }
        );
      }
      console.log(`[API_ROUTE] Image retry: message=${messageId} outfit=${retryOutfitId}`);
      const stream = createImageRetryStream(conversationId, messageId, retryOutfitId);
      return new Response(stream, { headers: SSE_HEADERS });
    }

    console.log(`[API_ROUTE] POST request received. Conv ID: ${conversationId}, Client ID: ${clientId}`);

    if (!text && !imageUrl) {
      return new Response(JSON.stringify({ error: "Text or image URL is required" }), { status: 400 });
    }

    const initialParts: Part[] = [];

    if (imageUrl) {
      const imagePart = await urlToGenerativePart(imageUrl);
      initialParts.push(imagePart);
    }

    if (text) {
      initialParts.push({ text });
    }

    const readableStream = createMultiAgentStream(initialParts, clientId!, conversationId, messageId, {
      clientIp: resolveClientIp(req),
    });
    return new Response(readableStream, { headers: SSE_HEADERS });
  } catch (e) {
    const error = e as Error;
    console.error("混合流式API顶层错误:", error);
    return new Response(JSON.stringify({ error: "服务器内部错误", message: error.message }), { status: 500 });
  }
}
