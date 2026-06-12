import retry from 'async-retry'; // 1. 导入 retry 库
import { genAI } from "server/services/ai";
import { uploadImageToGCS } from './gcs';
import { sendEvent } from '../utils/stream-helpers';
import { Part } from '@google/genai'; // <--- 新增: 导入 Part 类型
import { urlToGenerativePart } from '../utils/image'; // <--- 新增: 导入图片 URL 转换工具

// [NEW] Function to handle multimodal image generation with context
export async function generateAndSendImageWithContextInBackground(
    controller: ReadableStreamDefaultController,
    imgPrompt: string, 
    wardrobeImageUrls: string[],
    imageId: string,
    // [MODIFIED] The callback now provides both the ID and the URL
    onImageGenerated?: (id: string, url: string) => void
  ) {
    try {
      const publicUrl = await retry(async (bail, attemptNumber) => {
        console.log(`后端日志：[上下文图片][尝试 ${attemptNumber}] 开始调用多模态画图, Prompt:`, imgPrompt);
        
        let imageResponse;
        let useFallback = false;

        try {
          // 1. 构建多模态输入 (imagePart + textPart)
          const multiModalParts: Part[] = [];
          for (const url of wardrobeImageUrls) {
            try {
              const imagePart = await urlToGenerativePart(url);
              multiModalParts.push(imagePart);
            } catch (e) {
              console.warn(`[上下文图片] 转换衣橱图片URL失败，已跳过: ${url}`, e);
            }
          }
          multiModalParts.push({ text: imgPrompt }); // 文本 Prompt 放在最后

          // 2. 调用多模态图像生成模型
          imageResponse = await genAI.models.generateContent({
            model: "gemini-2.5-flash-image", // 您的图片生成模型
            contents: [{ role: "user", parts: multiModalParts }],
          });
        } catch (error) {
          console.warn(`后端日志：[上下文图片][尝试 ${attemptNumber}] 多模态画图接口调用抛出异常，触发保底，将回退到纯文本画图...`, error);
          useFallback = true;
        }

        let imagePart = !useFallback ? imageResponse?.candidates?.[0]?.content?.parts?.find(p => p.inlineData) : null;

        // 【安全退级兜底逻辑】
        // 如果多模态调用返回成功但由于安全政策审查（例如敏感类别过滤等）没有携带 inlineData，或者刚才捕获到了异常
        if (!imagePart?.inlineData) {
          console.warn(`后端日志：[上下文图片][尝试 ${attemptNumber}] 无法通过多模态正常生成图片，启动【纯文本生成保底机制】...`);
          if (imageResponse) {
            console.log("多模态生成未成功响应结构为:", JSON.stringify(imageResponse, null, 2));
          }

          try {
            imageResponse = await genAI.models.generateContent({
              model: "gemini-2.5-flash-image",
              contents: [{ role: "user", parts: [{ text: imgPrompt }] }],
            });
            imagePart = imageResponse?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
          } catch (fallbackError) {
            console.error(`后端日志：[上下文图片][尝试 ${attemptNumber}] 纯文本画图保底也失败了:`, fallbackError);
            throw fallbackError;
          }
        }

        if (imagePart?.inlineData) {
          const { data: base64Data, mimeType } = imagePart.inlineData;

          if (!base64Data || !mimeType) {
            throw new Error('模型返回的数据不完整，缺少 base64 数据或 MIME 类型。');
          }

          const destinationFileName = `outfits/${Date.now()}-${imageId}.png`;
          console.log(`后端日志：[上下文图片][尝试 ${attemptNumber}] 开始上传图片到 GCS: ${destinationFileName}`);
          const url = await uploadImageToGCS(base64Data, mimeType, destinationFileName);
          console.log(`后端日志：[上下文图片][尝试 ${attemptNumber}] 图片上传成功，URL: ${url}`);
          return url; // 成功时返回 URL
        } else {
          // 如果两次尝试后依然无图，报出非重试错误
          console.warn("后端日志：[上下文图片] 双重生成尝试后，图片API仍未返回图片数据。将不会重试。");
          bail(new Error("多模态与文本保底生成模型均未按预期返回图片数据。请检查提示词或安全设置。"));
          return '';
        }
      }, {
        retries: 2,       // 最多重试 2 次
        factor: 2,        // 每次等待时间乘以 2
        minTimeout: 2000, // 第一次等待 2 秒
        onRetry: (e: Error, attempt: number) => {
          console.warn(`后端日志：[上下文图片] 图片生成尝试 ${attempt} 失败 (错误: ${e.message})。正在重试...`);
        }
      });

      // 如果重试成功，publicUrl 会有值，发送事件
      if (publicUrl) {
        sendEvent(controller, 'image_generated', { id: imageId, imageUrl: publicUrl, alt: imgPrompt });
        // [MODIFIED] Call the callback with both the ID and the URL
        onImageGenerated?.(imageId, publicUrl);
      }

    } catch (e) {
      const error = e as Error;
      // 如果 retry 最终失败，会在这里捕获到错误
      console.error("后端日志：[上下文图片] !!! 图片生成在所有重试后仍然失败:", error);
      sendEvent(controller, 'image_generation_failed', { id: imageId, message: `画图失败：${error.message}`, alt: imgPrompt });
    }
  }

export async function generateAndSendImageInBackground(
    controller: ReadableStreamDefaultController,
    imgPrompt: string,
    imageId: string,
    // [MODIFIED] The callback now provides both the ID and the URL
    onImageGenerated?: (id: string, url: string) => void
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

          if (!base64Data || !mimeType) {
            throw new Error('模型返回的数据不完整，缺少 base64 数据或 MIME 类型。');
    }

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
        onRetry: (e: Error, attempt: number) => {
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
        // [MODIFIED] Call the callback with both the ID and the URL
        onImageGenerated?.(imageId, publicUrl);
      }
  
    } catch (e) {
      const error = e as Error;
      // 如果 retry 最终失败，会在这里捕获到错误
      console.error("后端日志：[后台任务] !!! 图片生成在所有重试后仍然失败:", error);
      sendEvent(controller, 'image_generation_failed', {
        id: imageId,
        message: `画图失败：${error.message}`,
        alt: imgPrompt
      });
    }
  }


