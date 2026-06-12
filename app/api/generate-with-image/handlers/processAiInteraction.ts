import { Content, Part, GenerateContentConfig } from '@google/genai';
import { genAI } from 'server/services/ai';
import { sendEvent } from '@/server/utils/stream-helpers';
import { generateAndSendImageInBackground, generateAndSendImageWithContextInBackground } from '@/server/services/generateImage';
import { ClothingItem } from '@prisma/client'; // Import ClothingItem
export async function processAiInteraction(
  chatConfig: { model: string; config: GenerateContentConfig; history: Content[] },
  initialParts: Part[],
  controller: ReadableStreamDefaultController,
  // [MODIFIED] The callback now accepts a data object for text or a generated image with its ID
  onData: (data: { text?: string; image?: { id: string; url: string } }) => void,
  ragCache: Map<string, ClothingItem> // [FIXED] Correctly type the cache to use ClothingItem
): Promise<Promise<void>[]> { // [MODIFIED] The function now returns the array of pending image promises
  const chat = genAI.chats.create(chatConfig);
  const pendingImageTasks: Promise<void>[] = [];

  async function processStreamStep(nextTurnParts: Part[]) {
    const result = await chat.sendMessageStream({ message: nextTurnParts });
    const allParts: Part[] = [];
    let characterCount = 0;
    const ERROR_THRESHOLD = 100000000000; 

    for await (const chunk of result) {
      const candidate = chunk.candidates?.[0];
      const parts = candidate?.content?.parts;
      if (parts) {
        allParts.push(...parts);
        const text = parts.find(p => p.text)?.text;
        if (text) {
          characterCount += text.length; // 累加字数

          if (characterCount >= ERROR_THRESHOLD) {
            console.log(`[DEBUG_THROW] Threshold of ${ERROR_THRESHOLD} reached. Throwing error!`);
            
            // 先把阈值前的最后一点文本发出去，让效果更逼真
            const partialText = text.substring(0, ERROR_THRESHOLD - (characterCount - text.length));
            sendEvent(controller, 'text_chunk', { text: partialText });
            onData({ text: partialText }); // [MODIFIED] Use the new data object format

            // 引爆炸弹！
            throw new Error(`人为制造的AI响应中断 (达到 ${ERROR_THRESHOLD} 字符)`);
          }

          sendEvent(controller, 'text_chunk', { text });
          onData({ text }); // [MODIFIED] Use the new data object format
        }
      }
    }

    const calls = allParts.filter(p => p.functionCall).map(p => p.functionCall);

    if (calls && calls.length > 0) {
      const functionResponsesForModel: Part[] = [];
      const gatekeeperCall = calls.find(call => call!.name === 'gatekeeper_check');
      if (gatekeeperCall) {
        const args = gatekeeperCall.args as { is_ready?: boolean; questions?: string[] };
        if (args.is_ready === false && Array.isArray(args.questions) && args.questions.length > 0) {
          const questionsText = args.questions.join(' ');
          sendEvent(controller, 'text_chunk', { text: questionsText });
          onData({ text: questionsText }); // [MODIFIED] Use the new data object format
          return;
        } else {
          functionResponsesForModel.push({ functionResponse: { name: 'gatekeeper_check', response: { content: "OK, prerequisite check passed. You can proceed." } } });
        }
      }

      for (const call of calls) {
        if (call!.name === 'image_generator' && call!.args?.prompt) {
          const imgPrompt = call!.args.prompt as string;
          const wardrobeItemsArg = call!.args.wardrobe_items as { id: string }[] | undefined;

          const imageId = `img-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
          sendEvent(controller, 'image_placeholder', { id: imageId, alt: imgPrompt });

          // [NEW STRATEGY] We are now in control. Inject a clean, predictable placeholder into the text stream.
          const placeholderText = `\n[IMAGE=${imageId}]\n`;
          onData({ text: placeholderText });

          let imagePromise: Promise<void>;

          // [MODIFIED] This callback still correctly sends the final ID and URL mapping upwards.
          const onImageGenerated = (id: string, url: string) => {
            onData({ image: { id, url } });
          };
          // --- [MODIFIED] Smartly decide which image generation function to call, and pass the new callback ---
          if (wardrobeItemsArg && wardrobeItemsArg.length > 0) {
            const imageUrls = wardrobeItemsArg.map(item => {
              const cachedItem = ragCache.get(item.id);
              return cachedItem?.imageUrl;
            }).filter((url): url is string => !!url);

            if (imageUrls.length > 0) {
              console.log(`[PROCESS_AI] Calling image generation with ${imageUrls.length} context images.`);
              imagePromise = generateAndSendImageWithContextInBackground(controller, imgPrompt, imageUrls, imageId, onImageGenerated);
            } else {
              console.log('[PROCESS_AI] Wardrobe items specified, but not found in cache. Falling back to simple image generation.');
              imagePromise = generateAndSendImageInBackground(controller, imgPrompt, imageId, onImageGenerated);
            }
          } else {
            console.log('[PROCESS_AI] No wardrobe items specified. Calling simple image generation.');
            imagePromise = generateAndSendImageInBackground(controller, imgPrompt, imageId, onImageGenerated);
          }
          // --- [END MODIFIED] ---

          pendingImageTasks.push(imagePromise);

          // [NEW STRATEGY] Return a simple 'OK' to the AI. Its job is done for this tool call.
          // We have already handled the placeholder injection.
          functionResponsesForModel.push({
            functionResponse: {
              name: 'image_generator',
              response: {
                content: "OK, image generation has been initiated."
              }
            }
          });
        }
      }

      if (functionResponsesForModel.length > 0) {
        await processStreamStep(functionResponsesForModel);
        return;
      }
    }
  }

  await processStreamStep(initialParts);

  // [NEW] Return the pending tasks so the caller can wait for them
  return pendingImageTasks;
}

