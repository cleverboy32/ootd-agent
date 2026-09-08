import { Part } from '@google/genai';

/** OpenAI-compatible multimodal chat 普遍支持的图片 MIME */
const LLM_SAFE_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export function normalizeImageMime(header: string | null | undefined): string {
  return header?.split(';')[0]?.trim().toLowerCase() ?? '';
}

export function isLlmSafeImageMime(mimeType: string): boolean {
  const mime = normalizeImageMime(mimeType);
  return LLM_SAFE_IMAGE_MIMES.has(mime);
}

/**
 * 将缓冲规范为 LLM 可接受的 jpeg/png/gif/webp。
 * AVIF/HEIC 等会转成 JPEG（上游常把不支持格式误报成 application/octet-stream）。
 */
export async function ensureLlmSafeImageBuffer(
  buffer: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const mime = normalizeImageMime(mimeType);
  if (!mime.startsWith('image/')) {
    throw new Error(`URL 指向的不是一个有效的图片文件。MIME 类型: ${mimeType}`);
  }

  if (isLlmSafeImageMime(mime)) {
    return {
      buffer,
      mimeType: mime === 'image/jpg' ? 'image/jpeg' : mime,
    };
  }

  console.log(`[UTILS] LLM 不支持 ${mime}，转换为 image/jpeg`);
  const sharp = (await import('sharp')).default;
  const jpeg = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
  return { buffer: jpeg, mimeType: 'image/jpeg' };
}

/**
 * 从一个URL下载图片并将其转换为 Generative AI 的 Part 对象。
 * @param url 图片的公网 URL。
 */
export async function urlToGenerativePart(url: string): Promise<Part> {
  try {
    console.log(`[UTILS] 开始从 URL 获取图片: ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`图片获取失败。状态码: ${response.status}`);
    }

    const rawMime = response.headers.get('content-type');
    const mimeType = normalizeImageMime(rawMime);
    if (!mimeType.startsWith('image/')) {
      throw new Error(`URL 指向的不是一个有效的图片文件。MIME 类型: ${rawMime}`);
    }
    console.log(`[UTILS] 图片 MIME 类型: ${mimeType}`);

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const safe = await ensureLlmSafeImageBuffer(imageBuffer, mimeType);
    console.log(`[UTILS] 图片已成功转换为 Base64（${safe.mimeType}）。`);

    return {
      inlineData: {
        data: safe.buffer.toString('base64'),
        mimeType: safe.mimeType,
      },
    };
  } catch (error) {
    console.error('[UTILS] 将 URL 转换为 Part 时出错:', error);
    throw new Error('处理提供的图片 URL 时发生错误。');
  }
}
