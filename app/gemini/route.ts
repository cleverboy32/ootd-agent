import { GoogleGenAI, Part } from "@google/genai";
import { NextRequest } from "next/server";


// 初始化 Google Generative AI 客户端
// 它现在会自动使用上面通过 undici 设置的全局代理
const genAI = new GoogleGenAI({
  vertexai: true,
  project: process.env.PROJECT_ID || "",
  location: process.env.LOCATION || "",
});

// 用于将图片文件转换为 Google Generative AI 所需的格式
async function fileToGenerativePart(file: File): Promise<Part> {
  const arrayBuffer = await file.arrayBuffer();
  const base64EncodedData = Buffer.from(arrayBuffer).toString("base64");
  return {
    inlineData: {
      data: base64EncodedData,
      mimeType: file.type,
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.PROJECT_ID || !process.env.LOCATION) {
      console.error("PROJECT_ID or LOCATION environment variables are not set");
      return new Response(JSON.stringify({ error: "Server not configured. Missing PROJECT_ID or LOCATION." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const formData = await req.formData();
    const file = formData.get("image") as File | null;
    const prompt = formData.get("prompt") as string | null;

    if (!file && !prompt) {
      return new Response(JSON.stringify({ error: "Missing image or prompt" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const parts: Part[] = [];
    
    if (prompt) {
      parts.push({ text: prompt });
    } else if (file) {
      parts.push({ text: "请帮我搭配这件衣服，并给出具体的穿搭建议。" });
    }

    if (file) {
      const imagePart = await fileToGenerativePart(file);
      parts.push(imagePart);
    }

    console.log("Calling Vertex AI API directly (expecting proxy to intercept)...");
    
    const result = await genAI.models.generateContentStream({
        model: "gemini-2.5-pro", // 遵从您的指示，使用稳定强大的 Pro 模型
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: "你是一名顶尖的时尚搭配师。用户会上传衣物照片或提出穿搭问题。你需要根据场合、季节、用户的体型或偏好，提供专业、有品位且落地的穿搭建议。语气要亲切、专业。排版要清晰美观，多使用 Markdown 的列表和加粗等格式分点说明。",
        }
    });

    // 【关键】在这里打印出 Google 返回的完整对象，以便我们能看到真正的错误信息
    console.log("Full result object from Google:", result);

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        for await (const chunk of result) {
          const text = chunk.text;
          if (text) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
          }
        }
        controller.close();
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    console.error("Vertex AI API Error:", error);
    const errorMessage = error.message || 'An unknown error occurred';
    const errorDetails = error.details ? JSON.stringify(error.details) : 'No additional details';
    return new Response(JSON.stringify({ error: "Internal server error", message: errorMessage, details: errorDetails }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

