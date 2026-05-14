import { Content, Part } from "@google/genai";
import { genAI, mainModelConfig } from "@/app/lib/google-ai";
import prismadb from '@/lib/prisma';
import { uploadImageToGCS } from "@/app/services/gcs-service"
import { Message as PrismaMessage } from '@prisma/client';
import retry from 'async-retry'; // 1. 导入 retry 库
import { generateSummary } from "@/lib/services/summarization-service";
import { urlToGenerativePart } from '@/app/lib/image';

// --- 辅助函数定义在外部 ---

const CONTEXT_TOKEN_LIMIT = 1000; // 为模型最大值留出一些余地

function estimateTokenCount(history: Content[]): number {
  let totalToken = 0;
  for (const message of history) {
    for (const part of message.parts) {
      if (part.text) {
        totalToken += Math.floor(part.text.length / 2);
      } else if (part.inlineData) {
        totalToken += 250; // 为每张图片估算一个固定的 token 值
      }
    }
  }
  return totalToken;
}

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
 * --- [核心修改] ---
 * 在后台异步生成图片，包含重试逻辑，上传到 GCS，并发送图片 URL 事件。
 */
async function generateAndSendImageInBackground(
  controller: ReadableStreamDefaultController,
  imgPrompt: string, 
  imageId: string
) {
  try {
    // 2. 使用 retry 包裹图片生成和上传的整个过程
    const publicUrl = await retry(async (bail, attemptNumber) => {
      console.log(`后端日志：[后台任务][尝试 ${attemptNumber}] 开始调用画图工具, Prompt:`, imgPrompt);
      
      const imageResponse = await genAI.models.generateContent({
        model: "gemini-2.5-flash-image", // 您的图片生成模型
        contents: [{ role: "user", parts: [{ text: imgPrompt }] }],
      });

      const parts = imageResponse?.candidates?.[0]?.content?.parts;
      const imagePart = parts?.find(p => p.inlineData);

      if (imagePart?.inlineData) {
        const base64Data = imagePart.inlineData.data;
        const mimeType = imagePart.inlineData.mimeType;

        const destinationFileName = `outfits/${Date.now()}-${imageId}.png`;
        
        console.log(`后端日志：[后台任务][尝试 ${attemptNumber}] 开始上传图片到 GCS: ${destinationFileName}`);
        const url = await uploadImageToGCS(base64Data, mimeType, destinationFileName);
        console.log(`后端日志：[后台任务][尝试 ${attemptNumber}] 图片上传成功，URL: ${url}`);
        return url; // 成功时返回 URL
      } else {
        // 如果 API 调用成功但没有返回图片数据，这是一个不应重试的错误
        console.warn("后端日志：[后台任务] 图片API调用成功，但未返回图片数据。将不会重试。");
        // bail 会阻止 async-retry 继续重试
        bail(new Error("模型未按预期返回图片数据。"));
        return ''; // 这里需要返回一个值以满足 TypeScript，但它不会被使用
      }
    }, {
      retries: 2,       // 最多重试 2 次
      factor: 2,        // 每次等待时间乘以 2
      minTimeout: 2000, // 第一次等待 2 秒
      onRetry: (e, attempt) => {
        console.warn(`后端日志：[后台任务] 图片生成尝试 ${attempt} 失败 (错误: ${e.message})。正在重试...`);
      }
    });

    // 如果重试成功，publicUrl 会有值，发送事件
    if (publicUrl) {
      sendEvent(controller, 'image_generated', {
        id: imageId,
        imageUrl: publicUrl,
        alt: imgPrompt
      });
    }

  } catch (e: any) {
    // 如果 retry 最终失败，会在这里捕获到错误
    console.error("后端日志：[后台任务] !!! 图片生成在所有重试后仍然失败:", e);
    sendEvent(controller, 'image_generation_failed', {
      id: imageId,
      message: `画图失败：${e.message}`,
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


// --- [新增] --- 辅助函数，用于将数据库消息格式化为 Google AI 的 History 格式

async function formatHistoryAsync(messages: PrismaMessage[]): Promise<Content[]> {
  if (!messages || messages.length === 0) {
    return [];
  }
  const history: Content[] = [];

  for (const msg of messages) {
    let role = msg.role;
    if (role !== 'user' && role !== 'model' && role !== 'ai') continue;
    if (role === 'ai') role = 'model';

    // 1. 从数据库解析出我们的自定义 Part 数组
    let dbParts: { type: string, content: any }[] = [];
    try {
      const content = msg.content as any;
      if (Array.isArray(content)) {
        dbParts = content;
      } else if (typeof content === 'string') {
        dbParts = [{ type: 'text', content: content }];
      } else if (content && content.text) { // 兼容旧的简单文本格式
        dbParts = [{ type: 'text', content: content.text }];
      }
    } catch (e) {
      console.error("无法解析数据库中的消息 content:", msg.content, e);
      continue;
    }
    
    // 2. 将自定义 dbParts 数组转换成官方的 SDK Part[] 数组
    const sdkParts: Part[] = [];
    for (const dbPart of dbParts) {
      if (dbPart.type === 'text' && typeof dbPart.content === 'string') {
        // 创建一个只包含 `text` 属性的有效 Part
        sdkParts.push({ text: dbPart.content });
      } else if (dbPart.type === 'image' && typeof dbPart.content === 'string' && dbPart.content.startsWith('http')) {
        try {
          // 调用工具函数，它会返回一个只包含 `inlineData` 属性的有效 Part
          const imagePart = await urlToGenerativePart(dbPart.content);
          sdkParts.push(imagePart);
        } catch (e) {
          console.error(`无法处理历史图片URL: ${dbPart.content}`, e);
          // 这里可以选择跳过这个坏掉的图片，或者添加一个错误提示文本
          sdkParts.push({ text: `[图片加载失败: ${dbPart.content}]` });
        }
      }
      // 在这里可以扩展以处理其他类型的 dbPart
    }

    if (sdkParts.length === 0) continue;

    // 3. 合并或添加到最终的 history 数组中
    if (history.length > 0 && history[history.length - 1].role === role) {
      history[history.length - 1].parts.push(...sdkParts);
    } else {
      history.push({ role, parts: sdkParts });
    }
  }
  
  if (history.length > 0 && history[0].role === 'model') history.shift();
  return history;
}

// --- 主流创建函数 ---

/**
 * 创建一个用于处理OOTD（今日穿搭）请求的 ReadableStream。
 * @param initialParts - 用户初始输入的内容（文本和/或图片）。
 * @returns 一个 ReadableStream 实例。
 */
export function createOotdStream(initialParts: Part[], clientId?: string, conversationId?: string): ReadableStream {
  
  return new ReadableStream({
    async start(controller) {
      console.log("[CONTROLLER_LOG] --- 新的 ReadableStream 已创建 ---");
      const pendingImageTasks: Promise<void>[] = [];

      // --- [新增] --- 获取个性化配置的逻辑
      let personalizedConfig = mainModelConfig;
      let historyForAI: Content[] = [];

       // --- 增加调试日志 ---
       console.log(`\n[CONTEXT_DEBUG] --- 开始为会话构建上下文 ---`);
       console.log(`[CONTEXT_DEBUG] 传入的 conversationId: ${conversationId}`);

      if (conversationId) {
        try {

           // 1. 加载最新的摘要和未被摘要的新消息
           const latestSummary = await prismadb.summary.findFirst({
            where: { conversationId },
            orderBy: { createdAt: 'desc' },
          });

          if (latestSummary) {
            console.log(`[CONTEXT_DEBUG] 找到最新摘要，创建于: ${latestSummary.createdAt}`);
            console.log(`[CONTEXT_DEBUG] 摘要内容: "${latestSummary.content.substring(0, 100)}..."`);
          } else {
            console.log(`[CONTEXT_DEBUG] 未找到任何摘要。`);
          }

          const newMessages = await prismadb.message.findMany({
            where: {
              conversationId,
              createdAt: {
                // 只获取在最新摘要之后创建的消息
                gt: latestSummary?.summarizedUntil,
              },
            },
            orderBy: { createdAt: 'asc' },
          });

          console.log(`有新对话${newMessages.length}条`)

          const unsummarizedHistory = await formatHistoryAsync(newMessages);
          const summaryContent = latestSummary?.content || null;

          // 2. 估算 Token
          const summaryToken = summaryContent ? Math.floor(summaryContent.length / 2) : 0;
          const historyToken = estimateTokenCount(unsummarizedHistory);
          const totalToken = summaryToken + historyToken;
          console.log(`[CONTEXT] 预估 Token: 摘要(${summaryToken}) + 新消息(${historyToken}) = ${totalToken}`);

            // 3. 决策与压缩
            if (totalToken > CONTEXT_TOKEN_LIMIT) {
              console.log(`[CONTEXT] Token 超出限制 (${totalToken})，开始生成新摘要...`);
              
              // 调用服务生成新摘要
              const newSummaryContent = await generateSummary(summaryContent, unsummarizedHistory);
  
              if (newSummaryContent) {
                const lastMessageSummarized = newMessages[newMessages.length - 1];
                
                // 异步保存新摘要，不阻塞主流程
                prismadb.summary.create({
                  data: {
                    conversationId,
                    content: newSummaryContent,
                    summarizedUntil: lastMessageSummarized.createdAt,
                  }
                }).then(() => {
                  console.log(`[CONTEXT] 新摘要已成功保存到数据库。`);
                }).catch(e => {
                  console.error(`[CONTEXT] 保存新摘要失败:`, e);
                });
  
                // 构建用于本次请求的 AI 历史
                historyForAI = [{ role: 'user', parts: [{ text: `--- 前情提要 ---\\n${newSummaryContent}` }] }];
              } else {
                // 如果摘要生成失败，则只使用最新的消息作为回退
                historyForAI = unsummarizedHistory.slice(-20); // 保留最后20条
              }
            } else {
              // Token 未超限，正常组合历史
              if (summaryContent) {
                historyForAI.push({ role: 'user', parts: [{ text: `--- 前情提要 ---\\n${summaryContent}` }] });
              }
              historyForAI.push(...unsummarizedHistory);
            }
        } catch(e) {
          console.error(`[HISTORY] 加载历史消息失败:`, e);
        }
      }

      if (clientId) {
        try {
          const clientProfile = await prismadb.clientProfile.findUnique({
            where: { id: clientId },
          });

          if (clientProfile && clientProfile.profileData) {
            const profile = clientProfile.profileData as Record<string, any>;
            let userContext = "关于当前用户，我们有以下已知信息，请在你的回复中酌情参考：\\n";
            
            if (profile.name) userContext += `- 姓名: ${profile.name}\\n`;
            if (profile.height) userContext += `- 身高: ${profile.height}\\n`;
            if (profile.weight) userContext += `- 体重: ${profile.weight}\\n`;
            if (profile.preferences) userContext += `- 偏好: ${Array.isArray(profile.preferences) ? profile.preferences.join(', ') : profile.preferences}\\n`;
            
            const dynamicSystemInstruction = `${mainModelConfig.systemInstruction}\\n\\n${userContext}`;
            
            personalizedConfig = {
              ...mainModelConfig,
              systemInstruction: dynamicSystemInstruction,
            };
            console.log(`[USER_CONTEXT] 已为 Client ${clientId} 加载个性化配置。 ${JSON.stringify(profile)}`);
          }
        } catch (e) {
          console.error(`[USER_CONTEXT] 为 Client ${clientId} 获取用户信息失败:`, e);
          // 如果获取失败，继续使用默认配置，不中断流程
        }
      }

      const chat = genAI.chats.create({
        model: 'gemini-2.5-pro',
        config: personalizedConfig,
        history: historyForAI,
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