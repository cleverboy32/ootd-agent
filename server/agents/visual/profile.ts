import { Type, Schema } from '@google/genai';
import { llmGenerate } from '@/server/services/llm/client';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { urlToGenerativePart } from '@/server/utils/image';

export interface VisualProfileResult {
  is_valid_portrait: boolean;
  skin_tone: string;
  body_shape: string;
  visual_features: {
    hair_color: string;
    detected_features: string;
  };
}

const visualProfileSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    is_valid_portrait: {
      type: Type.BOOLEAN,
      description:
        '是否为清晰可辨的人物正面/半身/全身自拍。衣物平铺图、风景、动物、模糊无法识别人脸的照片填 false。',
    },
    skin_tone: {
      type: Type.STRING,
      description:
        '肤色色调（冷/暖）及穿搭色彩建议。非人物照时填空字符串。',
    },
    body_shape: {
      type: Type.STRING,
      description:
        '身材类型（如沙漏型、梨型、矩形型等）及版型建议。非人物照时填空字符串。',
    },
    visual_features: {
      type: Type.OBJECT,
      properties: {
        hair_color: {
          type: Type.STRING,
          description:
            '发色，必须使用简体中文，如深棕色、黑色、浅金色。非人物照时填 unknown。',
        },
        detected_features: {
          type: Type.STRING,
          description:
            '发型、配饰、气质等客观描述，必须使用简体中文。非人物照时填 none。',
        },
      },
      required: ['hair_color', 'detected_features'],
    },
  },
  required: ['is_valid_portrait', 'skin_tone', 'body_shape', 'visual_features'],
};

const VISUAL_PROFILE_SYSTEM_INSTRUCTION = `
你是一个世界顶级的时尚量体师，专门分析用户自拍照片中的人物外形特征，为穿搭推荐提供依据。

【分析维度】
1. 肤色 (skin_tone)：判断冷/暖色调，给出适合的色彩建议（如米白、燕麦、暖橘等）。
2. 身材 (body_shape)：识别身材类型（沙漏型、梨型、苹果型、矩形型、倒三角型等），给出版型与比例建议。
3. 外形特征 (visual_features)：发色、发型、眼镜/配饰、整体气质等客观描述。

【语言要求】
所有面向用户的文字（skin_tone、body_shape、visual_features.hair_color、visual_features.detected_features）必须使用简体中文，禁止输出英文发色或英文描述。

【有效性判定】
- is_valid_portrait = true：清晰可辨的人物自拍（正面/半身/全身均可）。
- is_valid_portrait = false：非人物照、衣物平铺、风景、过度模糊、无法识别人脸。

【安全与尊重】
- 客观专业，充满建设性。
- 禁止贬低、年龄歧视、体型羞辱；用时尚术语表达（如「适合拉长比例」而非贬义词）。
- 不推断姓名、地址等隐私信息。
- 无法分析时不编造，将 is_valid_portrait 设为 false。
`;

export async function analyzeVisualProfileFromImage(imageUrl: string): Promise<VisualProfileResult> {
  const imagePart = await urlToGenerativePart(imageUrl);

  const response = await withRetryOn429(
    () =>
      llmGenerate({
        model: AGENT_MODELS.userProfile,
        systemInstruction: VISUAL_PROFILE_SYSTEM_INSTRUCTION,
        temperature: 0.2,
        jsonSchema: visualProfileSchema,
        contents: [
          {
            role: 'user',
            parts: [
              { text: '请分析这张用户自拍照片中的人物外形特征，用于时尚穿搭推荐。' },
              imagePart,
            ],
          },
        ],
      }),
    { label: 'VisualProfile' }
  );

  const responseText = response.text;
  if (!responseText) {
    throw new Error('Empty response from Visual Profile Agent');
  }

  console.log('[VISUAL_PROFILE_AGENT] Raw response:', responseText);
  return JSON.parse(responseText) as VisualProfileResult;
}
