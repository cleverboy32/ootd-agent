import { Content, Part, GenerateContentConfig } from '@google/genai';
import { genAI } from 'server/services/ai';
import { handleStreamCompletion, sendEvent } from '@/server/utils/stream-helpers';
import { generateAndSendImageInBackground } from '@/server/services/generateImage';

export async function processAiInteraction(
  chatConfig: { model: string; config: GenerateContentConfig; history: Content[] },
  initialParts: Part[],
  controller: ReadableStreamDefaultController,
  onChunk: (text: string) => void // <-- 新增的回调参数
): Promise<void> { // The function now returns the full text content
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
            onChunk(partialText);
            
            // 引爆炸弹！
            throw new Error(`人为制造的AI响应中断 (达到 ${ERROR_THRESHOLD} 字符)`);
          }

          sendEvent(controller, 'text_chunk', { text });
          onChunk(text);
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
          onChunk(questionsText);
          await handleStreamCompletion(controller, pendingImageTasks);
          return;
        } else {
          functionResponsesForModel.push({ functionResponse: { name: 'gatekeeper_check', response: { content: "OK, prerequisite check passed. You can proceed." } } });
        }
      }

      for (const call of calls) {
        if (call!.name === 'image_generator' && call!.args?.prompt) {
          const imgPrompt = call!.args.prompt as string;
          const imageId = `img-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
          sendEvent(controller, 'image_placeholder', { id: imageId, alt: imgPrompt });
          const imagePromise = generateAndSendImageInBackground(controller, imgPrompt, imageId);
          pendingImageTasks.push(imagePromise);
          functionResponsesForModel.push({ functionResponse: { name: 'image_generator', response: { content: `OK, image generation for '${imgPrompt.substring(0, 30)}...' started.` } } });
        }
      }

      if (functionResponsesForModel.length > 0) {
        await processStreamStep(functionResponsesForModel);
        return;
      }
    }

    await handleStreamCompletion(controller, pendingImageTasks);
  }

  await processStreamStep(initialParts);
}