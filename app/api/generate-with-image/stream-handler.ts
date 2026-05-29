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

      // [FIXED] Correct cache type to store full ClothingItem objects
      const ragCache = new Map<string, ClothingItem>();

      try {
        const effectiveInitialParts = initialParts;
        const historyForAI: Content[] = await buildContext(conversationId);

        // --- [MODIFIED & FIXED] RAG Search Step ---
        if (clientId) {
          // [FIXED] Pass the ragCache map as the third argument
          const searchResults = await performRagSearch(effectiveInitialParts, clientId, ragCache);

          if (searchResults.xmlString && searchResults.items.length > 0) {
            // [CLEANUP] The cache is now populated inside performRagSearch. Redundant 'for' loop is removed.
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

        await processAiInteraction(
          {
            model: "gemini-2.5-pro",
            config: personalizedConfig,
            history: historyForAI,
          },
          effectiveInitialParts,
          controller,
          (chunk) => {
            accumulatedContent += chunk;
          },
          ragCache // <-- [NEW] Pass the cache down to the interaction processor
        );

        // --- [FINALIZATION LOGIC] ---
        if (finalMessageId) {
          console.log(
            `[DB_SAVE_SUCCESS] Saving ${accumulatedContent.length} chars for message ${finalMessageId}`,
          );
          await prismadb.message.update({
            where: { id: finalMessageId },
            data: {
              content: [{ type: "text", content: accumulatedContent }],
              status: "completed",
            },
          });
          console.log(
            `[STATEFUL_STREAM] Message ${finalMessageId} status updated to completed.`,
          );
        }
      } catch (error) {
        console.error(
          "[STREAM_HANDLER] An error occurred in the main stream process:",
          error,
        );
        if (finalMessageId) {
          console.log(
            `[DB_SAVE_FAILURE] Saving partial content (${accumulatedContent.length} chars) for message ${finalMessageId} before marking as failed.`,
          );
          // Even on failure, save what we've accumulated so far.
          await prismadb.message.update({
            where: { id: finalMessageId },
            data: {
              content: [{ type: "text", content: accumulatedContent }],
              status: "failed",
            },
          });
          console.log(
            `[STATEFUL_STREAM] Message ${finalMessageId} status updated to failed.`,
          );
        }
        handleStreamError(controller, [], error as Error, "MainProcess");
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

