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
    /**
     * 内搭可见性。collar_only=外层罩住、仅领缘暗示层次；open=门襟打开、需看清内搭前片。
     * 旧数据可能缺失；画图层按缺省策略处理。
     */
    inner_visibility?: 'collar_only' | 'open';
  };
}

export interface StylistResult {
  outfits: StylistOutfit[];
  anchor_item_image_data?: AnchorItemImageData;
  /** 待购锚点 COS URL；跨轮微调优先继承此字段 */
  anchor_image_url?: string;
  /** 本轮一起搭配的上传图，第一张与 anchor_image_url 相同 */
  purchase_image_urls?: string[];
  /** 上传图已经确认过的身份。重做时按 imageUrl 复用，不再重猜。 */
  upload_garments?: Array<{ imageUrl: string; slot: string; identity: string }>;
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
  /** 本轮上传图 URL。搭配师在检索前看这些图。 */
  currentImageUrls?: string[];
  /** 更早的搭配结果，从旧到新。重做时用来找回上传图身份。 */
  priorStylistResults?: StylistResult[];
  /** 已识别的上传单品图，附在选品调用里。 */
  uploadGarmentParts?: import('@google/genai').Part[];
  /**
   * 评测用：跳过用户衣橱 RAG，直接使用给定候选。空数组表示空衣橱。
   * 见 server/agents/stylist/evalWardrobe.ts
   */
  evalWardrobeItems?: import('./evalWardrobe').EvalWardrobeItem[];
  /** 评测用：强制注入 skill 名单（经 normalizeStylistSkillNames） */
  skillOverride?: string[];
  /** 评测用：返回本轮真实 RAG 的逐槽候选快照。 */
  onRagSnapshots?: (snapshots: import('../rag/search').RagSlotSnapshot[]) => void;
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
                layer: {
                  type: Type.STRING,
                  description:
                    '穿搭层级，只能是：top（炎热主上装；或凉～寒冷的保暖中间层）| inner_top（有外套时的内搭；微暖～微凉无中间层时上装标此层；凉及更冷为最里薄贴身打底）| outerwear（外套）| inner_bottom（全长外裤内的薄贴身速干/发热内搭裤）| bottom（外穿裤）| skirt（半身裙/连衣裙等所有裙装）| legwear（打底袜/长筒袜/连裤袜/羊羔绒袜型打底等可见腿层）| shoes | accessory（包/首饰/帽等，不含腿部保暖）。开衫、毛衣、衬衫若本套没有外套，必须标 top，禁止标 inner_top。微暖～微凉有外套时禁止再标一层 top 中间层；凉及更冷须可有 top 中间层。一套内 bottom 与 skirt 二选一。全长加绒/滑雪裤用 inner_bottom，禁止再叠羊羔绒 legwear；裙/短/七分外露小腿用 legwear，不开 inner_bottom。',
                },
                reason: {
                  type: Type.STRING,
                  description: '指出这件单品用什么特点满足本轮相关的要求，如天气、场合、风格或用户点名的条件，以及它在整套中的作用。天气跨档时按单品说明何时加穿、脱下或单穿。不罗列领、门襟、袖等无关结构。',
                },
                description: {
                  type: Type.STRING,
                  description:
                    '新品必填一句外观，供后续出图照抄：颜色、材质，以及肉眼可见的结构止点。厚薄影响选品时，写明面料厚薄或保暖结构。上装写领型、袖型与袖长止点（袖口落到腕/肘/上臂哪一段）、衣长止点（腰/髋/臀）；下装写裤型或裙型与下摆止点（膝/小腿中/踝）；鞋写鞋头、鞋面、鞋底、跟高、有无松紧带或绑带。禁止只写行话（如只写「窄袖」「直筒」却不写袖口或下摆落在哪）。用户否定上一版气质或品类时，禁止只改 name，description 必须写出可区分的外形差异。衣橱单品填空字符串。',
                },
              },
              required: ['id', 'name', 'layer', 'reason', 'description'],
            },
          },
          visual_composition: {
            type: Type.OBJECT,
            properties: {
              model_pose: { type: Type.STRING, description: '只用中文写姿态和神态：站立或行走、双手位置、视线。禁止写发色、发型、刘海、五官、脸型、年龄、身材、眼镜和人物设定。' },
              outfit_details: { type: Type.STRING, description: '只用中文写 selected_items 已有单品的材质、色彩与廓形。保留可见单品决定选用的厚薄或保暖结构，须与各件 description 一致。每件须写可出图的止点：袖长、衣长、裙长或裤长落到身体的哪一段；禁止只写行话不写止点。禁止出现清单外的服装、配饰或装备，佩戴位置也只能落在已选单品上。' },
              background: { type: Type.STRING, description: '只用中文写场景与光线。禁止写人物外形。' },
              inner_visibility: {
                type: Type.STRING,
                description:
                  '内搭可见程度，只能填 collar_only 或 open。仅当 selected_items 里同时有 outerwear 与 inner_top 且没有 top 中间层时控制内搭可见度：外层扣合只露领缘填 collar_only；外层敞开要看清内搭前片填 open。若同时有 top 中间层（外套+中层+最里内搭三层），最里 inner_top 必须被中层完全遮住，不可见；此规则优先于本字段。没有外套或没有内搭时填 open。',
              },
            },
            required: ['model_pose', 'outfit_details', 'background', 'inner_visibility'],
          },
        },
        required: ['id', 'overall_concept', 'selected_items', 'visual_composition'],
      },
    },
  },
  required: ['outfits'],
};

/** @deprecated 旧「只出 query」路径；主链路已改用 outfitPlanSearchSchema */
export const wardrobeSearchSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    wardrobe_search_queries: {
      type: Type.ARRAY,
      description: '3-6 条衣橱检索项。每条含 slot（槽位）与 query（中文检索词），slot 与 mainCategory 一一对应，禁止同一 slot 重复',
      items: {
        type: Type.OBJECT,
        properties: {
          slot: { type: Type.STRING, description: '穿搭槽位，必须是以下之一：top | inner_top | bottom | inner_bottom | skirt | shoes | outerwear | legwear | accessory（dress 视为 skirt 别名）' },
          query: {
            type: Type.STRING,
            description: '中文语义检索 query，用品类级短词（与衣橱中文描述对齐），不要整句英文',
          },
        },
        required: ['slot', 'query'],
      },
    },
  },
  required: ['wardrobe_search_queries'],
};

/** Plan+Query：一次输出多套骨架与每槽检索词 */
export const outfitPlanSearchSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    outfits: {
      type: Type.ARRAY,
      description:
        '穿搭方案骨架。用户要一套时只出 1 套；明确要多个选择时出 2 到 4 套。每套含 overall_concept 与各槽 target+search_query。',
      minItems: '1',
      maxItems: '4',
      items: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.STRING,
            description: '方案 id，从 outfit_1 起连续编号，最多到 outfit_4。',
          },
          overall_concept: {
            type: Type.STRING,
            description:
              '本套设计核心概念（中文）。有风格技能合法分支时须点名并简述气质；无风格技能时写场合与层次厚薄，可点明裤/裙路线，不要写成完整细款配方。',
          },
          slots: {
            type: Type.ARRAY,
            description: '本套要检索的槽位；每槽一条，不要同一套内重复 slot。',
            items: {
              type: Type.OBJECT,
              properties: {
                slot: {
                  type: Type.STRING,
                  description:
                    'top | inner_top | bottom | inner_bottom | skirt | shoes | outerwear | legwear | accessory。bottom=外穿裤；inner_bottom=全长外裤内薄贴身速干/发热内搭裤（冷/寒冷裤装开）；skirt=所有裙装；legwear=可见腿层（裙/短/七分）。inner_top=内搭：微暖～微凉有外套时与 outerwear 同开（不开 top）；凉及更冷与 top、outerwear 同开。无外套时禁止 inner_top。成品一套内 bottom 与 skirt 二选一；全长外裤用 inner_bottom 时禁止同套再开羊羔绒 legwear。',
                },
                target: {
                  type: Type.STRING,
                  description:
                    '该槽目标描述。有风格技能：颜色+形态+品类+可见止点。无风格技能：写清检索目标（袖长、厚薄或适穿℃、用途场景、面料族等）及天气背景，禁止预设完整细款名。',
                },
                search_query: {
                  type: Type.STRING,
                  description:
                    '向量检索叙述（1～3句中文），须与 target 同向并按衣橱 text 向量维度扩写：品类/袖长或鞋型、面料、层次角色（内搭/中层/外套等）、风格与正式度、场合、廓形、单件适穿℃；颜色仅强约束时写。禁止短关键词串（如「女 厚针织 日常」）；禁止万能词与完整细款长名。用户明确要购买该槽新品时留空，不搜衣橱旧单品。',
                },
                allow_new: {
                  type: Type.BOOLEAN,
                  description: '衣橱无合适件时是否允许 new_item；默认 true。',
                },
              },
              required: ['slot', 'target', 'search_query', 'allow_new'],
            },
          },
        },
        required: ['id', 'overall_concept', 'slots'],
      },
    },
  },
  required: ['outfits'],
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
