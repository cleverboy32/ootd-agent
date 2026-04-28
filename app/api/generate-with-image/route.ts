import { GoogleGenAI, FunctionDeclaration, Part, GenerateContentConfig } from "@google/genai";
import { NextRequest } from "next/server";

// Initialize Google AI client (using `GoogleGenAI` as per original import, but adjusting usage)
const genAI = new GoogleGenAI({
  vertexai: true,
  project: process.env.PROJECT_ID || "",
  location: process.env.LOCATION || "",
});

// Define the tools AI can use
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


// Configuration for the main generative model (Gemini 1.5 Pro)
const mainModelConfig: GenerateContentConfig = {
  systemInstruction: `你是一名顶尖的时尚搭配师。你的任务是为用户提供 2 到 3 个不同的穿搭方案。
你的工作流程是：先用文字描述一个方案，然后立刻为这个方案调用 image_generator 工具生成一张效果图。然后你再继续描述下一个方案，并再次调用工具。
请严格遵循“描述一个方案，然后立刻为该方案调用画图工具”的顺序，直到提供完所有建议。
使用 Markdown 格式化你的文本回复，使其清晰美观。如果用户提供了图片，请优先基于图片内容给出搭配建议。`,
  tools: [{ functionDeclarations: tools }],
};

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
      // Basic image data cleaning/validation
      let cleanBase64 = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;
      cleanBase64 = cleanBase64.replace(/["\s]/g, ""); // Remove quotes and spaces

      initialParts.push({
        inlineData: {
          data: cleanBase64,
          mimeType: mimeType,
        },
      });
    }

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        console.log("[CONTROLLER_LOG] --- New ReadableStream CREATED ---"); // <--- 添加这行
        const pendingImageTasks: Promise<void>[] = []; 
        const sendEvent = (eventName: string, data: object) => {
          // 在发送前打印日志并检查控制器状态
          console.log(`[CONTROLLER_LOG] Attempting to send event: '${eventName}'. Controller state (desiredSize):`, controller.desiredSize);
          if (controller.desiredSize === null) {
            console.warn(`[CONTROLLER_LOG] BLOCKED event '${eventName}' because controller is already closed.`);
            return; // 如果已关闭，则直接返回，防止报错
          }
          controller.enqueue(encoder.encode(`event: ${eventName}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        // Helper function to generate and send images in the background
        const generateAndSendImageInBackground = async (imgPrompt: string, imageId: string) => {
          try {
            console.log("后端日志：[后台任务] 开始调用画图工具, Prompt:", imgPrompt);
            const imageResponse = await genAI.models.generateContent({
              model: "gemini-2.5-flash-image", // Using a faster model for image generation
              contents: [{
                role: "user",
                parts: [{ 
                  text: imgPrompt
                }]
              }],
            });

            // Safely extract inlineData from the response
            const parts = imageResponse?.candidates?.[0]?.content?.parts;
            const imagePart = parts?.find(p => p.inlineData);

            if (imagePart?.inlineData) {
              console.log("后端日志：[后台任务] 图片生成成功，发送 image_generated 事件。");
              sendEvent('image_generated', {
                id: imageId, // <--- 这是关键修改：发送图片时带上ID
                imageUrl: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
                alt: imgPrompt
              });
            } else {
              console.warn("后端日志：[后台任务] 图片生成成功但未找到 inlineData。");
                // 下面这行是新加的，用来调试
                console.log("[IMAGE_DEBUG] Full response parts:", JSON.stringify(parts, null, 2));
                sendEvent('error', { message: `画图成功但未找到图片数据: "${imgPrompt.substring(0, 20)}..."` });
            }

          } catch (e) {
            console.error("后端日志：[后台任务] !!! 调用图片生成模型时发生错误:", e);
            sendEvent('error', { message: `为 "${imgPrompt.substring(0, 20)}..." 这张图的生成失败了` });
          }
        };

        // Start a chat session with the main model
        const chat = genAI.chats.create({
          model: 'gemini-2.5-pro',
          config: mainModelConfig,
        });

        // --- FIX STARTS HERE ---

        // Change the parameter to accept just the parts for the next turn
        // 修正：将参数更改为仅接受下一轮的 Part[]（部件数组）
        async function processStreamStep(nextTurnParts: Part[]) {
          // Change: Pass only the parts to sendMessageStream
          // 修正：仅将部件（Part[]）传递给 sendMessageStream
          const result = await chat.sendMessageStream({
            message: nextTurnParts
          });

          // 用于存储本轮对话收到的所有 Part，以便最后检查 functionCalls
          let allParts: any[] = [];

          // 1. Process and send text chunks immediately
          for await (const chunk of result) {
            const candidate = chunk.candidates?.[0];
            const parts = candidate?.content?.parts;

            if (parts) {
              allParts.push(...parts); // 收集所有 Part

              // 处理文本流
              const text = parts.find(p => p.text)?.text;
              if (text) {
                sendEvent('text_chunk', { text });
              }
            }
          }

          // 流结束后，从累加的 parts 中寻找 functionCalls
          const calls = allParts
            .filter(p => p.functionCall)
            .map(p => p.functionCall);

          if (calls && calls.length > 0) {
            const functionResponsesForModel: Part[] = [];

            for (const call of calls) {
              if (call.name === 'image_generator' && call.args?.prompt) {
                const imgPrompt = call.args.prompt as string;
                const imageId = `img-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`; // 1. 生成唯一ID

                // 2. 立即发送占位符事件
                sendEvent('image_placeholder', {
                  id: imageId,
                  alt: imgPrompt
                });

                // 3. 在后台开始生成图片，并传入ID
                const imagePromise =  generateAndSendImageInBackground(imgPrompt, imageId);
                pendingImageTasks.push(imagePromise); // <--- 添加这行


                // 4. 构造“假”回复，让模型继续
                functionResponsesForModel.push({
                  functionResponse: {
                    name: 'image_generator',
                    response: {
                      content: `OK, the image generation for '${imgPrompt.substring(0, 30)}...' has started in the background.`
                    },
                  },
                });
              }
            }

            // 5. Send the "fake" responses back to the model to trigger the next round of inference
            // This call is recursive and will continue until the model no longer calls tools.
            if (functionResponsesForModel.length > 0) {
              // Change: Pass only the parts, not the full object with role
              // 修正：仅传递部件（Part[]），而不是包含 role（角色）的完整对象
              await processStreamStep(functionResponsesForModel);
              return;
            } else {
              // If no relevant function calls were processed, but calls were present,
              // we might need to handle other types of calls or terminate.
              // For now, if functionResponsesForModel is empty, assume model is done.
              // Model has finished all reasoning and no more tool calls are present
              console.log("[CONTROLLER_LOG] No more function calls to process. Waiting for background tasks..."); // <--- 修改日志
              await Promise.all(pendingImageTasks); // <--- 添加这行，等待所有任务
              console.log("[CONTROLLER_LOG] All background tasks finished. Sending stream_end and closing controller."); // <--- 修改日志
              sendEvent('stream_end', { message: '所有内容已加载完毕' });
              controller.close();
            }
          } else {
            // Model has finished all reasoning and no more tool calls are present
            console.log("[CONTROLLER_LOG] Model finished its turn. Waiting for background tasks..."); // <--- 修改日志
            await Promise.all(pendingImageTasks); // <--- 添加这行，等待所有任务
            console.log("[CONTROLLER_LOG] All background tasks finished. Sending stream_end and closing controller."); // <--- 修改日志
            sendEvent('stream_end', { message: '所有内容已加载完毕' });
            controller.close();
          }
        }

        try {
          // Start the initial conversation process
          // Change: Pass only the initialParts, not inside an object with role
          // 修正：仅传递 initialParts，而不是放在包含 role 的对象中
          await processStreamStep(initialParts);
        } catch (error: any) {
          console.error("后端日志：会话流程中发生错误:", error);
          sendEvent('error', { message: '处理您的请求时发生意外错误。' });
          controller.close();
        }
        // --- FIX ENDS HERE ---
      },
      cancel(reason) { // <--- 添加这个 cancel 函数
        console.error("[CONTROLLER_LOG] --- ReadableStream CANCELLED --- Reason:", reason);
      }
    });

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


