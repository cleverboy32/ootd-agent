import { genAI } from "server/services/ai";
import { Prisma } from '@prisma/client';
import { GenerateContentConfig } from "@google/genai";


// The system instruction for the AI.
const extractionSystemInstruction = `
你是一个高度精准的、用于构建长期用户画像的助手。
你的唯一任务是，从用户的单条消息中，识别并提取出关于用户**自身的、稳定的**个人信息或长期偏好。

你必须严格区分“用户的一次性请求”和“关于用户自身的陈述”。
**绝对不要**提取那些仅仅是当前请求主体的物品（例如，当用户问“帮我找条裙子”时，不要提取“裙子”）。

你应该提取的信息包括：
- **个人身份信息**: 姓名 (name), 地理位置 (location), 联系方式 (contact)。
- **身体特征**: 身高 (height), 体重 (weight), 或其他身材描述。
- **长期风格偏好**: 例如，“我喜欢复古风格”、“我从不穿亮色的衣服”。 (放在 preferences 数组里)
- **钟爱的品牌**: 例如，“我的鞋子只买耐克的”。 (放在 favorite_brands 数组里)

---
**规则与示例:**

1.  **只返回一个 JSON 对象。** 如果没有可提取的稳定信息，必须返回一个空对象: {}。

2.  **示例 1 (提取身份信息):**
    *   用户说: "你好，我叫李明，我住在上海，你能帮我找件外套吗？"
    *   你应该返回: \`{ "name": "李明", "location": "上海" }\` (注意："外套" 被忽略了，因为它是一次性请求)

3.  **示例 2 (提取偏好和品牌):**
    *   用户说: "我身高180cm。我只喜欢穿阿迪达斯的黑色运动裤。"
    *   你应该返回: \`{ "height": "180cm", "preferences": ["只喜欢穿黑色运动裤"], "favorite_brands": ["阿迪达斯"] }\`

4.  **示例 3 (纯粹的请求):**
    *   用户说: "有没有适合晚宴的裙子推荐？"
    *   你应该返回: \`{}\` (因为这里没有任何关于用户自身的、稳定的信息)
---
`;


// A specific AI model configuration for information extraction.
const extractionModelConfig: GenerateContentConfig = {
  // We use a lower temperature to make the model's output more deterministic and stable.
  temperature: 0.2,
  // This is the key part: it instructs the model to only output JSON.
  responseMimeType: "application/json", 
  systemInstruction: extractionSystemInstruction
};

/**
 * Extracts user information from a given text using an AI model.
 * @param text The text content to analyze.
 * @returns A promise that resolves to a JSON object with the extracted information, or null if extraction fails or yields no data.
 */
export async function extractUserInfoFromText(text: string): Promise<Prisma.JsonObject | null> {
  // Prevent analyzing very short or meaningless text
  if (!text || text.trim().length < 5) {
    return null;
  }

  try {
    const response = await genAI.models.generateContent({
      model: "gemini-2.5-pro",
      config: extractionModelConfig,
      contents: text,
    });

    const jsonText = response.text;

    console.info(`分析书个人信息：${jsonText}`)

    if (!jsonText) {
      return null;
    }

    // Parse the JSON string returned by the AI
    const extractedData = JSON.parse(jsonText);

    // If the AI returns an empty object, we can consider it as no useful information extracted.
    if (Object.keys(extractedData).length === 0) {
      return null;
    }

    return extractedData;

  } catch (error) {
    console.error("Error during user info extraction:", error);
    // In a production environment, you might want to use a more robust logging system.
    return null;
  }
}