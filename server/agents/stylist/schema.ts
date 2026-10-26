import { Type, Schema } from '@google/genai';
import type { AnchorItemImageData } from '../intent';

export const MAX_OUTFIT_COUNT = 4;

/** 最多保留 4 套。已是 outfit_1 到 outfit_4 的 id 保持不变，其余按空位补号。 */
export function clampStylistOutfits<T extends { id: string }>(outfits: T[]): T[] {
  const kept = outfits.slice(0, MAX_OUTFIT_COUNT);
  const used = new Set<string>();
  const nextFree = (): string => {
    for (let n = 1; n <= MAX_OUTFIT_COUNT; n += 1) {
      const id = `outfit_${n}`;
      if (!used.has(id)) return id;
    }
    return `outfit_${MAX_OUTFIT_COUNT}`;
  };
  return kept.map((outfit) => {
    const id = outfit.id?.trim() ?? '';
    if (/^outfit_[1-4]$/.test(id) && !used.has(id)) {
      used.add(id);
      return outfit;
    }
    const assigned = nextFree();
    used.add(assigned);
    return { ...outfit, id: assigned };
  });
}

export interface StylistOutfit {
  id: string;
  overall_concept: string;
  selected_items: {
    id: string;
    name: string;
    layer: string;
    reason: string;
    /** 新品的一句外观。衣橱单品留空，结构以衣橱描述为准。 */
    description?: string;
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
  /** 本轮一起搭配的上传图，第一张与 anchor_image_url 相同 */
  purchase_image_urls?: string[];
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
  /** 写入 stylist-selection.jsonl */
  messageId?: string;
  signal?: AbortSignal;
}

export const stylistSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    outfits: {
      type: Type.ARRAY,
      description:
        '推荐的穿搭方案。用户要一套时只出 1 套。只有用户明确要多个选择时才出 2 到 4 套。不得超过 4 套。',
      minItems: '1',
      maxItems: '4',
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: '方案 id，从 outfit_1 起连续编号，最多到 outfit_4。' },
          overall_concept: { type: Type.STRING, description: '整套穿搭的设计核心概念（如：粉色活力运动风，兼顾防风与排汗）' },
          selected_items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: '衣橱单品填真实 ID；用户待购锚定单品或 AI 推荐新品填 "new_item"' },
                name: { type: Type.STRING, description: '单品名称' },
                layer: { type: Type.STRING, description: '穿搭层级，如 inner_top (内搭上装), outerwear (外套), bottom (下装), shoes (鞋履), accessory (配饰)' },
                reason: { type: Type.STRING, description: '选用此单品的理由：场合、天气或风格。不写领、门襟、袖这些结构。' },
                description: { type: Type.STRING, description: '新品必填一句外观，写颜色、材质和能看见的结构：领、门襟、袖和长短。衣橱单品填空字符串。' },
              },
              required: ['id', 'name', 'layer', 'reason', 'description'],
            },
          },
          visual_composition: {
            type: Type.OBJECT,
            properties: {
              model_pose: { type: Type.STRING, description: '只用中文写姿态和神态：站立或行走、双手位置、视线。禁止写发色、发型、刘海、五官、脸型、年龄、身材、眼镜和人物设定。' },
              outfit_details: { type: Type.STRING, description: '只用中文写 selected_items 已有单品的材质、色彩与廓形。每件须含长度或廓形词（及膝、到踝、九分、阔腿、直筒、短款、短裤、五分、过膝、中长、长款），不得省略。禁止出现清单外的服装、配饰或装备，佩戴位置也只能落在已选单品上。' },
              background: { type: Type.STRING, description: '只用中文写场景与光线。禁止写人物外形。' },
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
