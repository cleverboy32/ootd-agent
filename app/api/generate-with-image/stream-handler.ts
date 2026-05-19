import { Content, Part } from "@google/genai";
import { genAI } from "server/services/ai";
import prismadb from 'server/db';
import { Prisma } from '@prisma/client';
import { generateSummary } from "@/server/services/summarization";
import { CONTEXT_TOKEN_LIMIT, estimateTokenCount, formatHistoryAsync } from "@/server/utils/estimate-token";
import { mainModelConfig } from "@/server/utils/ootd-ai-config";
import { handleStreamCompletion, handleStreamError, sendEvent } from "@/server/utils/stream-helpers";
import { generateAndSendImageInBackground } from "@/server/services/generateImage";
import { Message } from "@/server/types/message";



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
       console.log(`[CONTEXT_DEBUG] --- 开始为会话构建上下文 ---`);
       console.log(`[CONTEXT_DEBUG] 传入的 conversationId: ${conversationId}`);

      if (conversationId) {
        try {

           // 1. 加载最新的摘要和未被摘要的新消息
           const latestSummary = await prismadb.summary.findFirst({
            where: { conversationId },
            orderBy: { createdAt: 'desc' },
          });

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

          const unsummarizedHistory = await formatHistoryAsync(newMessages as Message[]);
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
            const profile = clientProfile.profileData as Prisma.JsonObject;
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
              const args = gatekeeperCall.args as { is_ready?: boolean; questions?: string[] };
              const { is_ready, questions } = args;

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

        } catch (error) {
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