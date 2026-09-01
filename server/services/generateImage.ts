import retry from 'async-retry';
import { llmGenerateImage } from '@/server/services/llm/client';
import { uploadImageToCOS } from './cos';
import { sendEvent } from '../utils/stream-helpers';
import { AGENT_MODELS } from '@/server/config/models';

async function generateOutfitPng(imgPrompt: string): Promise<{ data: string; mimeType: string }> {
  return llmGenerateImage(imgPrompt, AGENT_MODELS.imageGen);
}

export async function generateAndSendImageWithContextInBackground(
  controller: ReadableStreamDefaultController,
  imgPrompt: string,
  _wardrobeImageUrls: string[],
  imageId: string,
  onImageGenerated?: (id: string, url: string) => void
) {
  try {
    const publicUrl = await retry(
      async (bail, attemptNumber) => {
        console.log(`后端日志：[上下文图片][尝试 ${attemptNumber}] 开始调用画图, Prompt:`, imgPrompt);
        try {
          const { data, mimeType } = await generateOutfitPng(imgPrompt);
          const destinationFileName = `outfits/${Date.now()}-${imageId}.png`;
          const url = await uploadImageToCOS(data, mimeType, destinationFileName);
          console.log(`后端日志：[上下文图片][尝试 ${attemptNumber}] 图片上传成功，URL: ${url}`);
          return url;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes('did not return image data')) {
            bail(error as Error);
            return '';
          }
          throw error;
        }
      },
      {
        retries: 2,
        factor: 2,
        minTimeout: 2000,
        onRetry: (e: Error, attempt: number) => {
          console.warn(`后端日志：[上下文图片] 图片生成尝试 ${attempt} 失败 (错误: ${e.message})。正在重试...`);
        },
      }
    );

    if (publicUrl) {
      sendEvent(controller, 'image_generated', { id: imageId, imageUrl: publicUrl, alt: imgPrompt });
      onImageGenerated?.(imageId, publicUrl);
    }
  } catch (e) {
    const error = e as Error;
    console.error('后端日志：[上下文图片] !!! 图片生成在所有重试后仍然失败:', error);
    sendEvent(controller, 'image_generation_failed', {
      id: imageId,
      message: `画图失败：${error.message}`,
      alt: imgPrompt,
    });
  }
}

export async function generateAndSendImageInBackground(
  controller: ReadableStreamDefaultController,
  imgPrompt: string,
  imageId: string,
  onImageGenerated?: (id: string, url: string) => void
) {
  return generateAndSendImageWithContextInBackground(controller, imgPrompt, [], imageId, onImageGenerated);
}
