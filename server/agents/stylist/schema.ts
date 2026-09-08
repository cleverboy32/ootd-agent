import { Type, Schema } from '@google/genai';
import type { AnchorItemImageData } from '../intent';

export interface StylistOutfit {
  id: string;
  overall_concept: string;
  selected_items: {
    id: string;
    name: string;
    layer: string;
    reason: string;
  }[];
  visual_composition: {
    model_pose: string;
    outfit_details: string;
    background: string;
  };
}

export interface StylistResult {
  outfits: StylistOutfit[];
  anchor_item_image_data?: AnchorItemImageData;
  /** 待购锚点 COS URL；跨轮微调优先继承此字段 */
  anchor_image_url?: string;
}

export interface StyleAdviceResult {
  topic: string;
  points: string[];
  personal_note?: string;
  followup?: string;
}

export interface StylistAgentOptions {
  previousStylistCache?: import('@/server/utils/messageContent').StylistCacheNode | null;
  /** 当上一轮 cache 丢了 URL 时，从更早 cache 找回的待购锚点 */
  previousAnchorImageUrl?: string;
}

export const stylistSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    outfits: {
      type: Type.ARRAY,
      description: '推荐的穿搭方案列表（包含 1 到 2 套方案）',
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: '方案唯一标识，如 outfit_1, outfit_2' },
          overall_concept: { type: Type.STRING, description: '整套穿搭的设计核心概念（如：粉色活力运动风，兼顾防风与排汗）' },
          selected_items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: '衣橱单品填真实 ID；用户待购锚定单品或 AI 推荐新品填 "new_item"' },
                name: { type: Type.STRING, description: '单品名称' },
                layer: { type: Type.STRING, description: '穿搭层级，如 inner_top (内搭上装), outerwear (外套), bottom (下装), shoes (鞋履), accessory (配饰)' },
                reason: { type: Type.STRING, description: '选用此单品的专业时尚理由' },
              },
              required: ['id', 'name', 'layer', 'reason'],
            },
          },
          visual_composition: {
            type: Type.OBJECT,
            properties: {
              model_pose: { type: Type.STRING, description: '模特的姿态与神态描述（英文，如：A young woman holding a tennis racket, smiling warmly）' },
              outfit_details: { type: Type.STRING, description: '服装的材质、色彩、廓形与细节描述（英文）。必须包含每件单品的精确长度/廓形词，如：knee-length / ankle-length / cropped / midi / maxi / shorts (5/10 length, above-the-knee) / wide-leg / straight-leg 等，不得省略。示例：Wearing a fitted light pink athletic top, paired with dark grey above-the-knee straight shorts' },
              background: { type: Type.STRING, description: '场景与光影背景描述（英文，如：An indoor modern table tennis court with soft lighting）' },
            },
            required: ['model_pose', 'outfit_details', 'background'],
          },
        },
        required: ['id', 'overall_concept', 'selected_items', 'visual_composition'],
      },
    },
  },
  required: ['outfits'],
};

export const wardrobeSearchSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    wardrobe_search_queries: {
      type: Type.ARRAY,
      description: '3-6 条衣橱检索项。每条含 slot（槽位）与 query（英文检索词），slot 与 mainCategory 一一对应，禁止同一 slot 重复',
      items: {
        type: Type.OBJECT,
        properties: {
          slot: { type: Type.STRING, description: '穿搭槽位，必须是以下之一：top | bottom | dress | shoes | outerwear | accessory' },
          query: { type: Type.STRING, description: '英文语义检索 query，宽泛描述该槽位可能拥有的单品' },
        },
        required: ['slot', 'query'],
      },
    },
  },
  required: ['wardrobe_search_queries'],
};

export const styleAdviceSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    topic: { type: Type.STRING, description: '建议主题，从用户 special_requests 或对话中提炼（如：高级感色彩搭配公式）' },
    points: { type: Type.ARRAY, items: { type: Type.STRING }, description: '核心建议要点，3-5 条，每条清晰、可操作' },
    personal_note: { type: Type.STRING, description: '基于用户档案（肤色/风格偏好）的个性化补充；无法个性化时留空字符串' },
    followup: { type: Type.STRING, description: '引导进入衣橱搭配的钩子（如：想看这个公式在您衣橱里的效果？）；可留空字符串' },
  },
  required: ['topic', 'points', 'personal_note', 'followup'],
};
