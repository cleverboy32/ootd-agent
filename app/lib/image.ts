// ... other imports ...
import { Part } from "@google/genai";

// ... other functions ...

/**
 * 从一个URL下载图片并将其转换为 Google Generative AI 的 Part 对象。
 * 这是将图片数据发送给 Gemini API 所必需的步骤。
 * @param url 图片的公网 URL。
 * @returns 一个 Promise，解析为适用于模型的 Part 对象。
 * @throws 如果图片下载或转换失败，则抛出错误。
 */
export async function urlToGenerativePart(url: string): Promise<Part> {
  try {
    console.log(`[UTILS] 开始从 URL 获取图片: ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`图片获取失败。状态码: ${response.status}`);
    }

    const mimeType = response.headers.get("content-type");
    if (!mimeType || !mimeType.startsWith("image/")) {
      throw new Error(`URL 指向的不是一个有效的图片文件。MIME 类型: ${mimeType}`);
    }
    console.log(`[UTILS] 图片 MIME 类型: ${mimeType}`);

    const imageBuffer = await response.arrayBuffer();
    const imageBase64 = Buffer.from(imageBuffer).toString("base64");
    console.log(`[UTILS] 图片已成功转换为 Base64。`);

    return {
      inlineData: {
        data: imageBase64,
        mimeType,
      },
    };
  } catch (error) {
    console.error("[UTILS] 将 URL 转换为 Part 时出错:", error);
    throw new Error("处理提供的图片 URL 时发生错误。");
  }
}