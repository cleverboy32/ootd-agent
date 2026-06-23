import { Type, Schema } from '@google/genai';

export interface UserProfileResult {
  name: string;
  height: string;
  weight: string;
  preferences: string[];
  skin_tone: string;
  body_shape: string;
  personal_style: string;
  visual_features: {
    hair_color: string;
    detected_features: string;
  };
}

export interface UserProfileAuditContext {
  conversationId?: string;
  messageId?: string;
  userMessage?: string;
}

export const userProfileSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    name: {
      type: Type.STRING,
      description:
        '用户姓名或昵称。仅当用户明确自我介绍（我叫/叫我/昵称是）时填写；称呼助手的「大哥」「亲」等不是姓名。未知且旧档案也没有则填空字符串。',
    },
    height: {
      type: Type.STRING,
      description: '用户身高（如 168cm）。若未知且旧档案中也没有，填空字符串。',
    },
    weight: {
      type: Type.STRING,
      description: '用户体重（如 52kg）。若未知且旧档案中也没有，填空字符串。',
    },
    preferences: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        '长期风格偏好（如喜欢极简、偏爱金色饰品、不爱穿外套）。禁止写入单次搭配请求、场合、或「想穿/想搭配某单品」等临时意图。确认选方案、点选衣橱单品时不要新增偏好。',
    },
    skin_tone: {
      type: Type.STRING,
      description: '仅保留旧档案中已有值；本次不从对话推断，无旧档案则填空字符串。',
    },
    body_shape: {
      type: Type.STRING,
      description: '仅保留旧档案中已有值；本次不从对话推断，无旧档案则填空字符串。',
    },
    personal_style: {
      type: Type.STRING,
      description:
        '用户明确说出的风格定位，或旧档案中已有值。用户未提及且无旧档案时填 "日常休闲"。禁止根据场合臆测（如上班≠知性风）。',
    },
    visual_features: {
      type: Type.OBJECT,
      properties: {
        hair_color: {
          type: Type.STRING,
          description: "仅保留旧档案中已有值；无旧档案则填 'unknown'",
        },
        detected_features: {
          type: Type.STRING,
          description: "仅保留旧档案中已有值；无旧档案则填 'none'",
        },
      },
      required: ['hair_color', 'detected_features'],
    },
  },
  required: ['name', 'height', 'weight', 'preferences', 'skin_tone', 'body_shape', 'personal_style', 'visual_features'],
};
