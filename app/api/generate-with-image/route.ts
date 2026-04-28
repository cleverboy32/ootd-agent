import { Part } from "@google/genai";
import { NextRequest } from "next/server";
import { createOotdStream } from "./stream-handler";

export async function POST(req: NextRequest) {
  try {
    const { prompt, base64Image, mimeType } = await req.json();

    if (!prompt && !base64Image) {
      return new Response(JSON.stringify({ error: "Prompt or image is required" }), { status: 400 });
    }

    const initialParts: Part[] = [];

    if (prompt) {
      initialParts.push({ text: prompt });
    }

    if (base64Image && mimeType) {
      let cleanBase64 = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;
      cleanBase64 = cleanBase64.replace(/["\s]/g, "");
      initialParts.push({
        inlineData: {
          data: cleanBase64,
          mimeType: mimeType,
        },
      });
    }

    // All complex logic is now in createOotdStream
    const readableStream = createOotdStream(initialParts);
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

