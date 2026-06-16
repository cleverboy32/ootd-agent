import { Content, Part } from "@google/genai";
import { ClothingItem } from '@prisma/client'; // [ADDED] Import ClothingItem type
import prismadb from "server/db";
import { mainModelConfig } from "@/server/utils/ootd-ai-config";
import { handleStreamError, sendEvent } from "@/server/utils/stream-helpers";

// Import the newly created handlers
import { buildContext } from "./handlers/buildContext";
import { loadPersonalization } from "./handlers/loadPersonalization";
import { processAiInteraction } from "./handlers/processAiInteraction";
import { performRagSearch } from './handlers/ragSearchHandler';
/**
 * Creates a readable stream for handling OOTD requests.
 * This function orchestrates the entire process, including state management for retries.
 * @param initialParts - User's initial input (text and/or image).
 * @param messageId - Optional ID of the message to retry.
 * @returns A ReadableStream instance.
 */
export function createOotdStream(
  initialParts: Part[],
  clientId?: string,
  conversationId?: string,
  messageId?: string, // For retry
): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      console.log("[CONTROLLER_LOG] --- 新的 ReadableStream 已创建 ---");
      let finalMessageId = messageId;
      let accumulatedContent = "";
      const imageMap = new Map<string, string>();
      const ragCache = new Map<string, ClothingItem>();

      // [NEW] Variables to manage state across the new structure
      let mainError: Error | null = null;
      let imageTasks: Promise<void>[] = [];

      try {
        const effectiveInitialParts = initialParts;
        const { historyForAI } = await buildContext(conversationId, finalMessageId);

        // --- [MODIFIED & FIXED] RAG Search Step ---
        if (clientId) {
          const textPart = effectiveInitialParts.find((part): part is { text: string } => 'text' in part);
          const queries = textPart?.text?.trim() ? [textPart.text.trim()] : [];
          const searchResults = await performRagSearch(queries, clientId, ragCache, {
            source: 'stream-handler',
            conversationId,
            userMessage: textPart?.text?.trim(),
          });

          if (searchResults.xmlString && searchResults.items.length > 0) {
            // [CLEANUP] The cache is now populated inside performRagSearch. Redundant 'for' loop is removed.
            console.log(`searchResults: ${JSON.stringify(searchResults.items)}`)
          historyForAI.push({
              role: 'user',
              parts: [{ text: `Here are some items from my wardrobe that might be relevant:\n${searchResults.xmlString}` }]
            });
          }
        }
        // --- [END MODIFIED & FIXED] ---

        if (finalMessageId) {
          // --- 断点续传逻辑 ---
          // 1. 从历史记录中找到并移除上一次AI失败的、不完整的回复
          let partialContent = "";
          if (
            historyForAI.length > 0 &&
            historyForAI[historyForAI.length - 1].role === "model"
          ) {
            const lastAiMessage = historyForAI.pop(); // 移除失败的model消息
            if (lastAiMessage?.parts) {
              // 2. 提取不完整的文本内容
              const textPart = lastAiMessage.parts.find((p) => "text" in p) as
                | { text: string }
                | undefined;
              if (textPart) {
                partialContent = textPart.text;
                console.log(
                  `[RETRY_LOGIC] 提取到中断内容: \"${partialContent.slice(0, 100)}...\"`,
          );
        }
            }
          }

          // 3. 构建一个精确的“续写”指令
          const continuePrompt = `你上一次的回复因为意外中断了。请从以下内容的结尾处无缝衔接，继续生成，不要重复已经说过的话，也不要加上“好的，继续”等多余的开场白。中断的内容如下：\n\n---
${partialContent}
---`;

          historyForAI.push({
            role: "user",
            parts: [{ text: continuePrompt }],
          });
        } else {
          if (!conversationId) {
            throw new Error(
              "conversationId is required for creating a new message.",
            );
          }
          console.log(
            "[STATEFUL_STREAM] New request, creating placeholder message...",
          );
          const placeholderMessage = await prismadb.message.create({
            data: {
              conversationId: conversationId,
              role: "assistant",
              content: {}, // Default empty content
              status: "generating",
              timestamp: new Date(),
            },
            select: { id: true },
          });
          finalMessageId = placeholderMessage.id;

          sendEvent(controller, "metadata", { messageId: finalMessageId });
          console.log(
            `[STATEFUL_STREAM] Metadata sent with Message ID: ${finalMessageId}`,
          );
        }

        // Step 2: Load personalization settings
        const personalizedConfig = await loadPersonalization(
          clientId,
          mainModelConfig,
        );
        // Step 3: Process the core AI interaction
        console.log(JSON.stringify(historyForAI), 333);

        // [MODIFIED] Capture the returned image promises
        imageTasks = await processAiInteraction(
          {
            model: "gemini-2.5-pro",
            config: personalizedConfig,
            history: historyForAI,
          },
          effectiveInitialParts,
          controller,
          // [MODIFIED] This callback now handles text chunks and image ID/URL pairs
          (data: { text?: string; image?: { id: string; url: string } }) => {
            if (data.text) {
              accumulatedContent += data.text;
            }
            if (data.image) {
              imageMap.set(data.image.id, data.image.url);
              console.log(`[STREAM_HANDLER] Mapped image ID ${data.image.id} to URL ${data.image.url}`);
            }
          },
          ragCache // <-- Pass the cache down to the interaction processor
        );

      } catch (error) {
        // [MODIFIED] In case of an error, just capture it. The finally block will handle the rest.
        mainError = error as Error;
        console.error(
          "[STREAM_HANDLER] An error occurred in the main stream process:",
          mainError
        );
      } finally {
        // [NEW] This block is the single exit point, ensuring graceful handling of all resources.

        console.log('[FINALLY] Waiting for all pending image tasks to settle...');
        await Promise.allSettled(imageTasks);
        console.log('[FINALLY] All image tasks have settled.');

        if (finalMessageId) {
          try {
            // Assemble the final content regardless of success or failure
            let finalContent = accumulatedContent;
            for (const [id, url] of imageMap.entries()) {
              const placeholder = `[IMAGE=${id}]`;
              const markdownImage = `\n\n![AI 生成的穿搭建议图片](${url})\n\n`;
              finalContent = finalContent.split(placeholder).join(markdownImage);
          }

            // 【安全退级机制】安全清洗所有可能因超时或失败未生成的占位符标签
            finalContent = finalContent.replace(/\[IMAGE=[^\]]+\]/g, '\n\n*(❌ 效果图生成失败)*\n\n');

            // Update DB with the final content and status
            const finalStatus = mainError ? 'failed' : 'completed';
            await prismadb.message.update({
              where: { id: finalMessageId },
              data: {
                  content: [{ type: "text", content: finalContent }],
                  status: finalStatus,
              },
            });
            console.log(`[FINALLY] DB record ${finalMessageId} updated with status: ${finalStatus}`);

          } catch (dbError) {
            console.error(`[FINALLY] Failed to update DB for message ${finalMessageId}:`, dbError);
          }
        }

        // If there was an error in the main process, send it to the client now
        if (mainError) {
          handleStreamError(controller, [], mainError, "MainProcess");
        } else {
          console.log('[FINALLY] Sending stream_end event and closing the stream controller.');
          sendEvent(controller, 'stream_end', { message: '所有内容已加载完毕' });
          if (controller.desiredSize !== null) {
            try {
              controller.close();
            } catch (e) {
              console.warn('[FINALLY] Controller was already closed by client or downstream:', e);
            }
          }
        }
      }
    },
    cancel(reason) {
      console.error(
        "[CONTROLLER_LOG] --- ReadableStream 被取消 --- 原因:",
        reason,
      );
      // TODO: Update message status to 'cancelled' if finalMessageId exists.
    },
  });
}

