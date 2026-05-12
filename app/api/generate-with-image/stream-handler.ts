import { Part } from "@google/genai";
import { genAI, mainModelConfig } from "@/app/lib/google-ai";
import prismadb from '@/lib/prisma';

// --- 辅助函数定义在外部 ---

/**
 * 向客户端发送一个 Server-Sent Event (SSE)。
 * @param controller - ReadableStream 的控制器。
 * @param eventName - 事件名称。
 * @param data - 要发送的数据对象。
 */
function sendEvent(controller: ReadableStreamDefaultController, eventName: string, data: object) {
  console.log(`[CONTROLLER_LOG] 准备发送事件: '${eventName}'. 控制器状态 (desiredSize):`, controller.desiredSize);
  if (controller.desiredSize === null) {
    console.warn(`[CONTROLLER_LOG] 事件 '${eventName}' 被阻止，因为控制器已经关闭。`);
    return;
  }
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`event: ${eventName}\n`));
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

/**
 * 在后台异步生成图片并发送相应事件。
 * @param controller - ReadableStream 的控制器。
 * @param imgPrompt - 用于生成图片的提示词。
 * @param imageId - 该图片的唯一标识符。
 */
async function generateAndSendImageInBackground(
  controller: ReadableStreamDefaultController,
  imgPrompt: string, 
  imageId: string
) {
  try {
    console.log("后端日志：[后台任务] 开始调用画图工具, Prompt:", imgPrompt);
    const imageResponse = await genAI.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [{ role: "user", parts: [{ text: imgPrompt }] }],
    });

    const parts = imageResponse?.candidates?.[0]?.content?.parts;
    const imagePart = parts?.find(p => p.inlineData);

    if (imagePart?.inlineData) {
      console.log("后端日志：[后台任务] 图片生成成功，发送 'image_generated' 事件。");
      sendEvent(controller, 'image_generated', {
        id: imageId,
        imageUrl: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
        alt: imgPrompt
      });
    } else {
      console.warn("后端日志：[后台任务] 图片API调用成功，但未返回图片数据。");
      console.log("[IMAGE_DEBUG] 模型返回的完整内容:", JSON.stringify(parts, null, 2));
      // 改为发送特定的图片生成失败事件
      sendEvent(controller, 'image_generation_failed', {
        id: imageId,
        message: `画图失败：模型未按预期返回图片数据。`,
        alt: imgPrompt
      });
    }
  } catch (e) {
    console.error("后端日志：[后台任务] !!! 调用图片生成模型时发生严重错误:", e);
    // 改为发送特定的图片生成失败事件
    sendEvent(controller, 'image_generation_failed', {
      id: imageId,
      message: `画图失败：调用图片模型API时出错。`,
      alt: imgPrompt
    });
  }
}

/**
 * 安全地完成并关闭数据流。
 * @param controller - ReadableStream 的控制器。
 * @param pendingImageTasks - 等待完成的后台图片生成任务列表。
 */
async function handleStreamCompletion(
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
    controller.close();
  }
}

/**
 * 处理流处理过程中的错误。
 * @param controller - ReadableStream 的控制器。
 * @param pendingImageTasks - 后台任务列表，用于最终的清理。
 * @param error - 捕获到的错误对象。
 * @param context - 错误发生的上下文描述。
 */
function handleStreamError(
  controller: ReadableStreamDefaultController,
  pendingImageTasks: Promise<void>[],
  error: any,
  context: string
) {
  console.error(`后端日志：在 [${context}] 中发生错误:`, error);
  sendEvent(controller, 'error', { message: `处理您的请求时发生意外错误: ${context}` });
  // 发生错误时，也尝试安全地关闭流
  handleStreamCompletion(controller, pendingImageTasks);
}


// --- 主流创建函数 ---

/**
 * 创建一个用于处理OOTD（今日穿搭）请求的 ReadableStream。
 * @param initialParts - 用户初始输入的内容（文本和/或图片）。
 * @returns 一个 ReadableStream 实例。
 */
export function createOotdStream(initialParts: Part[], clientId?: string): ReadableStream {
  
  return new ReadableStream({
    async start(controller) {
      console.log("[CONTROLLER_LOG] --- 新的 ReadableStream 已创建 ---");
      const pendingImageTasks: Promise<void>[] = [];

      // --- [新增] --- 获取个性化配置的逻辑
      let personalizedConfig = mainModelConfig;
      if (clientId) {
        try {
          const clientProfile = await prismadb.clientProfile.findUnique({
            where: { id: clientId },
          });

          if (clientProfile && clientProfile.profileData) {
            const profile = clientProfile.profileData as Record<string, any>;
            let userContext = "关于当前用户，我们有以下已知信息，请在你的回复中酌情参考：\\n";
            
            if (profile.name) userContext += `- 姓名: ${profile.name}\\n`;
            if (profile.location) userContext += `- 位置: ${profile.location}\\n`;
            if (profile.preferences) userContext += `- 偏好: ${Array.isArray(profile.preferences) ? profile.preferences.join(', ') : profile.preferences}\\n`;
            
            const dynamicSystemInstruction = `${mainModelConfig.systemInstruction}\\n\\n${userContext}`;
            
            personalizedConfig = {
              ...mainModelConfig,
              systemInstruction: dynamicSystemInstruction,
            };
            console.log(`[USER_CONTEXT] 已为 Client ${clientId} 加载个性化配置。`);
          }
        } catch (e) {
          console.error(`[USER_CONTEXT] 为 Client ${clientId} 获取用户信息失败:`, e);
          // 如果获取失败，继续使用默认配置，不中断流程
        }
      }

      const chat = genAI.chats.create({
        model: 'gemini-2.5-pro',
        config: personalizedConfig,
      });

      // 核心递归函数，处理与模型的每一轮对话
      async function processStreamStep(nextTurnParts: Part[]) {
        try {
          const result = await chat.sendMessageStream({
            message: nextTurnParts
          });
          const allParts: Part[] = [];

          // 1. 流式处理模型返回的文本块
          for await (const chunk of result) {
            const candidate = chunk.candidates?.[0];
            const parts = candidate?.content?.parts;
            if (parts) {
              allParts.push(...parts);
              const text = parts.find(p => p.text)?.text;
              if (text) {
                sendEvent(controller, 'text_chunk', { text });
              }
            }
          }

          // 2. 从完整响应中解析工具调用
          const calls = allParts.filter(p => p.functionCall).map(p => p.functionCall);

          if (calls && calls.length > 0) {
            const functionResponsesForModel: Part[] = [];


            // 1. 检查是否存在 gatekeeper_check 调用
            const gatekeeperCall = calls.find(call => call!.name === 'gatekeeper_check');
            if (gatekeeperCall) {
              const { is_ready, questions } = gatekeeperCall.args;
              if (is_ready === false && Array.isArray(questions) && questions.length > 0) {
                // AI 决定提问，发送问题并结束流程
                const combinedQuestions = questions.join(' ');
                sendEvent(controller, 'text_chunk', { text: combinedQuestions });
                await handleStreamCompletion(controller, pendingImageTasks);
                return; 
              } else {
                // AI 认为信息已就绪，准备一个"假"回复让它继续
                functionResponsesForModel.push({
                  functionResponse: {
                    name: 'gatekeeper_check',
                    response: { content: "OK, prerequisite check passed. You can proceed." },
                  },
                });
              }
            }


            for (const call of calls) {
              if (call!.name === 'image_generator' && call!.args?.prompt) {
                const imgPrompt = call!.args.prompt as string;
                const imageId = `img-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                
                // 立即向前端发送图片占位符事件
                sendEvent(controller, 'image_placeholder', { id: imageId, alt: imgPrompt });
                
                // 在后台启动图片生成任务，并追踪它
                const imagePromise = generateAndSendImageInBackground(controller, imgPrompt, imageId);
                pendingImageTasks.push(imagePromise);

                // 准备一个“假”回复给模型，让它继续工作
                functionResponsesForModel.push({
                  functionResponse: {
                    name: 'image_generator',
                    response: { content: `OK, image generation for '${imgPrompt.substring(0, 30)}...' started.` },
                  },
                });
              }
            }

            // 如果我们生成了有效的工具调用回复，就继续递归
            if (functionResponsesForModel.length > 0) {
              await processStreamStep(functionResponsesForModel);
              return; // 递归结束后，立刻返回，防止执行下方的结束逻辑
            } 
          } 

          // 3. 如果没有更多步骤，则安全地结束流
          await handleStreamCompletion(controller, pendingImageTasks);

        } catch (error: any) {
          // 统一处理主流程中的任何错误
          handleStreamError(controller, pendingImageTasks, error, "MainProcess");
        }
      }

      // 启动整个流程
      await processStreamStep(initialParts);
    },
    cancel(reason) {
      console.error("[CONTROLLER_LOG] --- ReadableStream 被取消 --- 原因:", reason);
    }
  });
}