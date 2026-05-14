import { Part } from "@google/genai";
import { NextRequest } from "next/server";
import { createOotdStream } from "./stream-handler";
import {  urlToGenerativePart } from '@/app/lib/image';


export async function POST(req: NextRequest) {
  try {
    const { content, conversationId } = await req.json();
    const { text, imageUrl } = content;

    const clientId = req.headers.get('X-Client-ID'); 

    if (!text && !imageUrl) {
      return new Response(JSON.stringify({ error: "Text or image URL is required" }), { status: 400 });
    }

    const initialParts: Part[] = [];

    // 3. 如果 imageUrl 存在，调用工具函数获取图片数据并转换为 Part
    if (imageUrl) {
      console.log(`[API_ROUTE] 收到图片 URL，开始转换: ${imageUrl}`);
      const imagePart = await urlToGenerativePart(imageUrl);
      initialParts.push(imagePart);
    }

   // 4. 如果文本存在，添加文本 Part
    // 注意：Gemini 多模态输入要求图片在前，文本在后，我们调整一下顺序
    if (text) {
      initialParts.push({ text: text });
    }

    console.log(`[API_ROUTE] 准备调用 createOotdStream，包含 ${initialParts.length} 个 part(s)。`);

    // All complex logic is now in createOotdStream
    const readableStream = createOotdStream(initialParts, clientId!, conversationId);
    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    console.error("混合流式API顶层错误:", error);
    return new Response(JSON.stringify({ error: "服务器内部错误", message: error.message }), { status: 500 });
  }
}

