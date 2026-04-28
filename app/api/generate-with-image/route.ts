import { GoogleGenAI, FunctionDeclaration, Part } from "@google/genai";
import { NextRequest } from "next/server";
// 初始化 Google AI 客户端
const genAI = new GoogleGenAI({
  vertexai: true,
  project: process.env.PROJECT_ID || "",
  location: process.env.LOCATION || "",
});

// 定义AI可以使用的“画图”工具
const tools: FunctionDeclaration[] = [
  {
    name: "image_generator",
    description: "当需要根据文本描述生成一张效果图或可视化图片时调用此工具。",
    parametersJsonSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "用于生成图片的、详细的、具有画面感的英文描述。",
        },
      },
      required: ["prompt"],
    },
  },
];


export async function POST(req: NextRequest) { // 1. Changed back to POST
  try {
    // 2. Read prompt, base64Image, mimeType from request body
    const { prompt, base64Image, mimeType } = await req.json();

    if (!prompt && !base64Image) {
      return new Response(JSON.stringify({ error: "Prompt or image is required" }), { status: 400 });
    }

    const contentsParts: Part[] = [];

    if (prompt) {
      contentsParts.push({ text: prompt });
    }

    // If base64Image is provided, convert it to a Part and add to contents
    if (base64Image && mimeType) {

      let cleanBase64 = base64Image.includes(",") 
      ? base64Image.split(",")[1] 
      : base64Image;

      cleanBase64 = cleanBase64.replace(/["\s]/g, "");

      contentsParts.push({
        inlineData: {
          data: cleanBase64,
          mimeType: mimeType,
        },
      });
    }

    const result = await genAI.models.generateContentStream({
      model: "gemini-2.5-pro",
      contents: [{ role: "user", parts: contentsParts }],
      config: {
        systemInstruction: "你是一名顶尖的时尚搭配师。用户会上传衣物照片或提出穿搭问题。你需要根据场合、季节、用户的体型或偏好，提供专业、有品位且落地的穿搭建议。语气要亲切、专业。排版要清晰美观，多使用 Markdown 的列表和加粗等格式分点说明。如果用户提供了图片，请优先基于图片内容给出搭配建议，并可生成一张效果图。",
        tools: [{
          functionDeclarations: tools
        }]
      }
    });

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        const sendEvent = (eventName: string, data: object) => {
          controller.enqueue(encoder.encode(`event: ${eventName}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        for await (const chunk of result) {
          const text = chunk.text;
          if (text) {
            sendEvent('text_chunk', { text });
          }

          const functionCalls = chunk.functionCalls;
          if (functionCalls) {
            for (const call of functionCalls) {
              if (call.name === 'image_generator') {
                const imgPrompt = call.args?.prompt as string;
                console.log("后端日志：开始调用画图工具，Prompt:");
                
                try {
                  // 4. 调用生成图片的模型（同样使用 client.models）
                  const imageResponse = await genAI.models.generateContent({
                    model: "gemini-2.5-flash-image",
                    contents: [{ role: "user", parts: [{ text: imgPrompt }] }],
                  });

                  const parts = imageResponse?.candidates?.[0]?.content?.parts ?? [];
                  for (const part of parts) {
                    if (part.inlineData) {
                      console.log("后端日志：图片生成成功，准备发送 image_generated 事件。");
                      sendEvent('image_generated', {
                        imageUrl: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                        alt: imgPrompt
                      });
                    }
                  }
                } catch (e) {
                  console.error("后端日志：!!! 调用图片生成模型时发生错误:", e);
                  sendEvent('error', { message: "画图失败了" });
                }
              }
            }
          }
        }
        
        sendEvent('stream_end', { message: '所有内容已加载完毕' });
        
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
    console.error("混合流式API错误:");
    return new Response(JSON.stringify({ error: "服务器内部错误", message: error.message }), { status: 500 });
  }
}