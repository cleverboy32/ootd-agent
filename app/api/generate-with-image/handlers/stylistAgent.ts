import { Content, Part, Type, Schema } from '@google/genai';
import { genAI } from '@/server/services/ai';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { UserProfileResult, profileHasVisualData } from './userProfileAgent';
import { performRagSearch } from './ragSearchHandler';
import { WardrobeSearchQuery, parseWardrobeSearchSlot, WardrobeSearchSlot } from '@/server/utils/ragSearchSlots';
import { ClothingItem } from '@prisma/client';
import {
  AnchorItemInfo,
  AnchorItemImageData,
  AnchorSlot,
  GatekeeperIntent,
  getResolvedAnchorFromIntent,
  isPurchasePairingIntent,
  isWardrobePairingIntent,
  outfitIdToLabel,
} from './intentTypes';
import type { StylistCacheNode } from '@/server/utils/messageContent';

// 定义 Stylist Agent 的输出 Schema
const stylistSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    outfits: {
      type: Type.ARRAY,
      description: '推荐的穿搭方案列表（包含 1 到 2 套方案）',
      items: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.STRING,
            description: '方案唯一标识，如 outfit_1, outfit_2',
          },
          overall_concept: {
            type: Type.STRING,
            description: '整套穿搭的设计核心概念（如：粉色活力运动风，兼顾防风与排汗）',
          },
          selected_items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: {
                  type: Type.STRING,
                  description:
                    '衣橱单品填真实 ID；用户待购锚定单品或 AI 推荐新品填 "new_item"',
                },
                name: {
                  type: Type.STRING,
                  description: '单品名称',
                },
                layer: {
                  type: Type.STRING,
                  description:
                    '穿搭层级，如 inner_top (内搭上装), outerwear (外套), bottom (下装), shoes (鞋履), accessory (配饰)',
                },
                reason: {
                  type: Type.STRING,
                  description: '选用此单品的专业时尚理由',
                },
              },
              required: ['id', 'name', 'layer', 'reason'],
            },
          },
          visual_composition: {
            type: Type.OBJECT,
            properties: {
              model_pose: {
                type: Type.STRING,
                description:
                  '模特的姿态与神态描述（英文，如：A young woman holding a tennis racket, smiling warmly）',
              },
              outfit_details: {
                type: Type.STRING,
                description:
                  '服装的材质、色彩与细节描述（英文，如：Wearing a fitted light pink athletic top, paired with dark grey sports shorts）',
              },
              background: {
                type: Type.STRING,
                description:
                  '场景与光影背景描述（英文，如：An indoor modern table tennis court with soft lighting）',
              },
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

const STYLIST_SYSTEM_INSTRUCTION = `
你是一个世界顶级的虚拟时尚造型师与首席设计师 (Stylist Agent)。
你的唯一任务是结合“今日用户时尚档案”、“结构化意图”以及“RAG 检索出的衣橱 XML 列表”，进行深度的色彩、材质、版型搭配，输出 1 到 2 套结构化的穿搭方案。

【核心搭配原则】
1. 衣橱优先 (Wardrobe First)：
   - 你必须【优先】尝试使用用户衣橱 XML 列表 (<relevant_wardrobe_items>) 中的单品。这是最重要的规则。
   - 只有当衣橱单品不足以搭配出完美的方案时，你才可以推荐 1-2 件新品（ID 填 "new_item"），并在 reason 中注明。
2. 单品适配判断（重要，先筛后搭）：
   - 衣橱优先【不等于】必须用上每一件召回的单品。XML 中每个 item 带有 similarity（语义相似度 0~1）、subCategory（具体品类）、tags（风格标签），你必须先逐件判断它是否真的适配【本次场合与风格】，再决定是否选用。
   - 场合/风格冲突：若场合偏正式/商务/通勤，而单品 tags 偏运动休闲（如 sporty、activewear、athletic、streetwear、y2k）或 similarity 明显偏低，视为【不适配】，不要为了凑数硬选。
   - 品类不符：某槽位召回的单品 subCategory/tags 与目标品类不符（例如想要「包」，但候选全是 Earrings/Necklace/Ring/Choker 等首饰），判定该槽位【衣橱无合适单品】，禁止用首饰冒充包等其它品类。
   - 不适配槽位的处理（按优先级）：① 同槽位若有更适配候选则改选它；② 否则用 "new_item" 补位，并在 reason 注明「衣橱暂无合适的 XX，建议补充…」；③ 仅当核心槽位（top/bottom/shoes）多数缺失时才酌情减少方案数量，不要轻易拒绝出方案。
   - similarity 仅作参考权重，最终以场合/风格/品类的语义判断为准；不要机械按分数高低选择。
3. 科学搭配 (Scientific Styling)：
   - 【special_requests 优先】：若 special_requests 中有明确的色彩/风格方向（如「高级感大地色系」「同色系叠搭」），必须以此为首要选色原则，而非凭空发挥。
   - 色彩协调学：仅当档案中有肤色分析时结合肤色搭配；无则基于服装色彩与场合搭配。
   - 版型互补学：仅当档案中有身材分析时结合身材版型；无则基于通用版型原则。
   - 场合与天气契合度：严格契合提取的场合和天气温度。
   - 季节协调（重要）：同一套方案内所有单品的 season 须有交集。温暖/夏季/户外场合禁止搭配仅冬季适用的厚外套（如 Puffer Jacket、羽绒）与夏季下装（短裤、骑行裤）同套出现；优先选择 Windbreaker 等轻薄外套。
4. 多套方案 (Multi-Outfit Support)：
   - 默认应为用户提供 1 到 2 套不同的穿搭方案（例如：方案一为裙装，方案二为裤装；或者方案一为通勤风，方案二为休闲风）。
   - 每套方案必须有一个唯一的 id（如 outfit_1、outfit_2），以便后续文案和绘图精准对应。

【待购单品搭配模式 purchase_pairing】
- 当上下文标明 request_type=purchase_pairing 且提供了【锚定单品】时进入此模式。
- 每套方案【必须】包含该锚定单品：id 固定为 "new_item"，name 使用锚定单品名称，layer 与其槽位对应。
- 其余单品【必须优先】从衣橱 XML 选取，用于与锚定单品形成互补（色彩、风格、版型协调）。
- 禁止忽略锚定单品，禁止仅用衣橱单品拼出一套与锚定单品无关的方案。
- 禁止为锚定单品槽位再从衣橱选替代品覆盖锚定单品。

【衣橱锚定搭配模式 wardrobe_pairing】
- 当 request_type=wardrobe_pairing 且提供了【衣橱锚定单品 id】时进入此模式。
- 每套方案【必须】包含该锚定单品：id 填真实衣橱 id（非 new_item），layer 与其槽位对应。
- 其余单品【必须优先】从衣橱 XML 选取互补单品。
- 禁止为锚定单品槽位再从衣橱选替代品覆盖锚定单品。

【反馈微调模式 feedback_revision（重要）】
- 当 request_type=feedback_revision 且提供了【上一轮方案 JSON】时进入此模式。
- 【只输出 1 套】方案，id 必须与 selected_outfit_id 一致（如 outfit_1）。
- 在上一轮方案基础上【精准修改】：保留用户未提及的单品 id 不变，仅调整 special_requests 中要求的槽位。
- 禁止重新推荐完全无关的全新方案；禁止输出 2 套。

【多轮对话与反馈微调模式】
- 仔细阅读历史对话。如果用户在上一轮已经得到了推荐，而当前输入是针对上一轮方案的修改反馈（例如：“第一套太正式了，换成裤装”、“外套不要红色的”）。
- 你必须【自动转为反馈微调模式】：在上一轮方案的基础上进行精准修改，保留用户满意的部分，仅调整用户要求修改的部分。不要盲目重新推荐一套完全无关的方案。

【视觉构想指南 (Visual Composition)】
- 为后续的绘图智能体提供清晰的画面构想，包含模特姿态、服装细节、背景场景。
- 描述必须使用英文，且细节丰富。
- 确保 visual_composition 中的服装细节（outfit_details）与你选用的 selected_items 保持 100% 的色彩与款式一致。
- 若用户档案【无可靠外形数据】（无肤色/身材/发色分析）：model_pose 只描述姿态与场景，使用 "a fashion model" 等通用表述，禁止编造具体发色、眼镜、五官、体型、年龄。
- 若档案中有视觉分析数据：model_pose 才可引用发色等已知特征以保持一致。
`;

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
}

const wardrobeSearchSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    wardrobe_search_queries: {
      type: Type.ARRAY,
      description:
        '3-6 条衣橱检索项。每条含 slot（槽位）与 query（英文检索词），slot 与 mainCategory 一一对应，禁止同一 slot 重复',
      items: {
        type: Type.OBJECT,
        properties: {
          slot: {
            type: Type.STRING,
            description:
              '穿搭槽位，必须是以下之一：top | bottom | dress | shoes | outerwear | accessory',
          },
          query: {
            type: Type.STRING,
            description: '英文语义检索 query，宽泛描述该槽位可能拥有的单品',
          },
        },
        required: ['slot', 'query'],
      },
    },
  },
  required: ['wardrobe_search_queries'],
};

const WARDROBE_SEARCH_INSTRUCTION = `
你是时尚造型师，负责为【用户已有衣橱】生成语义检索 query。你的目标是在向量数据库里召回真实存在的单品，而不是描述理想中的造型。

【核心原则：衣橱优先 (Wardrobe First)】
- 你尚未看到用户衣橱，因此 query 必须宽泛、包容，覆盖用户【可能拥有】的品类，而非臆造具体款式。
- 禁止预设用户未必拥有的具体颜色、面料或单品（如 "oatmeal knit"、"beige A-line midi dress"、"brown leather sandals"）。
- 优先使用：品类 + 季节/天气 + 场合/风格。颜色仅在与用户明确要求时加入，且用宽泛词（如 "light-colored"、"neutral"）。

【槽位检索 (Slot-based)】
- 每条输出必须包含 slot 和 query。slot 决定数据库 mainCategory 过滤，query 负责语义匹配：
  - top → TOP（T-shirt, blouse, tank top…）
  - bottom → BOTTOM（trousers, pants, jeans, shorts, skirt…）
  - dress → ONE_PIECE（连衣裙、连体装；仅在裙装路线时使用）
  - shoes → FOOTWEAR（sneakers, hiking shoes, flats…优先 sneakers）
  - outerwear → OUTERWEAR（cardigan, jacket, windbreaker…视天气决定）
  - accessory → ACCESSORY（bag, belt, scarf, hat…仅在有需要时使用）
- 用户要「一套」穿搭时：优先 3-5 条，覆盖 top + bottom + shoes（+ 可选 outerwear / accessory），不要同时搜裤装路线和 dress 槽位。
- accessory 槽位为【可选】：日常极简通勤可省略；正式场合、约会、派对、用户要求「加点配饰」等场景应加入 1 条宽泛配饰 query。
- 需要 2 套不同方案时：最多 6 条，可按方案分组（如裤装 3 条 + 裙装 3 条），但同一槽位仍不重复。

【query 写法】
- 使用英文，适合向量语义检索。
- 输出 JSON 数组，每项格式：{ "slot": "top", "query": "short sleeve casual top summer commute" }
- 只输出检索 query，不输出搭配方案。
`;

const PURCHASE_PAIRING_SEARCH_ADDENDUM = `
【待购单品搭配模式 — 互补槽位检索】
- 用户有一套【待购锚定单品】不在衣橱中，你只为【互补槽位】生成 query。
- 【禁止】检索与锚定单品相同槽位的衣物（该槽位已由用户待购单品占据）。
- query 应体现与锚定单品的搭配关系（色彩协调、风格呼应），但品类描述保持宽泛。
- 锚定单品为 dress 时：只检索 shoes、outerwear、accessory，不要检索 top/bottom。
- 锚定单品为 top 时：检索 bottom + shoes（+ 可选 outerwear），不要检索 top。
- 锚定单品为 bottom 时：检索 top + shoes（+ 可选 outerwear），不要检索 bottom。
- 锚定单品为 shoes 时：检索 top + bottom（或 dress），不要检索 shoes。
- 锚定单品为 outerwear 时：检索 top + bottom + shoes，不要检索 outerwear。
- 锚定单品为 accessory（耳环、项链、包、腰带等）时：【必须】检索 top + bottom + shoes 共至少 3 条 query（+ 可选 outerwear），不要检索 accessory。目标是从衣橱找完整穿搭来衬托配饰。
`;

const WARDROBE_PAIRING_SEARCH_ADDENDUM = `
【衣橱锚定搭配模式 — 互补槽位检索】
- 用户指定了【衣橱已有锚定单品】（真实 id），你只为【互补槽位】生成 query。
- 【禁止】检索与锚定单品相同槽位的衣物。
- 规则同待购单品搭配：锚定为 dress 时只检索 shoes/outerwear/accessory；top 时检索 bottom+shoes 等。
`;

export interface StyleAdviceResult {
  topic: string;
  points: string[];
  personal_note?: string;
  followup?: string;
}

const styleAdviceSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    topic: {
      type: Type.STRING,
      description: '建议主题，从用户 special_requests 或对话中提炼（如：高级感色彩搭配公式）',
    },
    points: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '核心建议要点，3-5 条，每条清晰、可操作',
    },
    personal_note: {
      type: Type.STRING,
      description: '基于用户档案（肤色/风格偏好）的个性化补充；无法个性化时留空字符串',
    },
    followup: {
      type: Type.STRING,
      description: '引导进入衣橱搭配的钩子（如：想看这个公式在您衣橱里的效果？）；可留空字符串',
    },
  },
  required: ['topic', 'points', 'personal_note', 'followup'],
};

const STYLE_ADVICE_SYSTEM_INSTRUCTION = `
你是一名世界顶级的时尚造型师与穿搭顾问。
用户正在向你咨询某种风格、色彩或穿搭方法的建议与知识。

你的核心任务：**读懂用户当前的理解水平**，给出深度匹配的建议，无需询问场合或生成搭配方案。

【知识水平判断规则】
- 仔细阅读对话历史，判断用户对该话题的熟悉程度
- 用户表现出「不懂/刚接触」的信号：措辞疑惑（"啊？""这是什么？""原来还有这么多？"）、提问很基础（"有哪些颜色？""是什么风格？"）→ 回答侧重**清晰解释基础概念**，语气亲切，不堆砌专业术语
- 用户表现出「已懂基础/想深入」的信号：明确说「进阶」「深入」「高阶」「怎么搭配更高级」，或已能准确使用专业术语 → 可以给出实操技巧和进阶规则
- **当不确定时，宁可简单，不要复杂**

可以参考用户的个人档案（肤色、风格偏好）做适当的个性化补充。

输出必须是结构化 JSON，包含：
- topic：建议主题，语气和难度与用户当前问题层级一致（用户问基础问题 → topic 就是基础解答，禁止自行升格为"进阶指南"）
- points：3-5 条核心要点，深度与 topic 匹配；如用户明显是初学者，每条先解释概念再举例，避免只列操作步骤
- personal_note：结合用户肤色/偏好的个性化建议（有档案数据时填写；无则留空字符串）
- followup：引导用户进入衣橱搭配的自然钩子（可选，留空字符串则不显示）
`;

/**
 * 调用 Stylist Agent 生成结构化风格建议（advice 模式，不走 RAG）
 */
export async function callStylistAdvice(
  history: Content[],
  initialParts: Part[],
  intent: GatekeeperIntent,
  profile: UserProfileResult
): Promise<StyleAdviceResult> {
  console.log('[STYLIST_AGENT] Generating style advice...');

  const hasVisualProfile = profileHasVisualData(profile);
  const userMessage = extractUserMessage(initialParts);

  const prompt = `
【今日用户时尚档案】
- 风格偏好: ${profile.preferences.join(', ') || '未提供'}
- 肤色: ${profile.skin_tone || '未分析'}
- 个人风格: ${profile.personal_style || '未分析'}
- 可靠外形数据: ${hasVisualProfile ? '有（可做个性化建议）' : '无'}

【用户咨询主题】
- 原始诉求: ${intent.special_requests || '用户咨询穿搭建议'}
- 风格偏好: ${intent.style_preference || '未提供'}
- 场合背景: ${intent.occasion || '未限定'}

【用户当前消息】
${userMessage || '（请根据历史对话推断咨询主题）'}

请针对用户的咨询主题，给出专业、实用的风格建议。
`;

  const contents: Content[] = [...history, { role: 'user', parts: [{ text: prompt }] }];

  const response = await withRetryOn429(
    () =>
      genAI.models.generateContent({
        model: AGENT_MODELS.stylist,
        contents,
        config: {
          systemInstruction: STYLE_ADVICE_SYSTEM_INSTRUCTION,
          temperature: 0.5,
          responseMimeType: 'application/json',
          responseSchema: styleAdviceSchema,
        },
      }),
    { label: 'Stylist advice' }
  );

  const responseText = response.text;
  if (!responseText) {
    throw new Error('Empty response from Stylist advice mode');
  }

  console.log('[STYLIST_AGENT] Advice raw response:', responseText);
  return JSON.parse(responseText) as StyleAdviceResult;
}

export interface StylistAgentOptions {
  previousStylistCache?: StylistCacheNode | null;
}

function extractUserMessage(initialParts: Part[]): string {
  const textPart = initialParts.find((part): part is { text: string } => 'text' in part);
  return textPart?.text?.trim() || '';
}

function filterQueriesExcludingAnchorSlot(
  queries: WardrobeSearchQuery[],
  anchorSlot?: WardrobeSearchSlot | AnchorSlot
): WardrobeSearchQuery[] {
  if (!anchorSlot) return queries;
  return queries.filter((item) => item.slot !== anchorSlot);
}

function anchorSlotToLayer(slot: WardrobeSearchSlot): string {
  const map: Record<WardrobeSearchSlot, string> = {
    top: 'inner_top',
    bottom: 'bottom',
    dress: 'dress',
    shoes: 'shoes',
    outerwear: 'outerwear',
    accessory: 'accessory',
  };
  return map[slot] ?? 'inner_top';
}

async function planWardrobeSearchQueries(
  history: Content[],
  intent: GatekeeperIntent,
  profile: UserProfileResult,
  userMessage: string,
  anchorItem: AnchorItemInfo | null
): Promise<WardrobeSearchQuery[]> {
  console.log('[STYLIST_AGENT] Planning wardrobe search queries...');

  const isPairing = (isPurchasePairingIntent(intent) || isWardrobePairingIntent(intent)) && anchorItem;
  const pairingBlock = isPairing
    ? `
【锚定单品】
- 名称: ${anchorItem.name}
- 描述: ${anchorItem.summary}
- 槽位: ${anchorItem.slot}（请勿为此槽位生成检索 query）
${isWardrobePairingIntent(intent) ? '- 来源: 用户衣橱已有单品（真实 id）' : '- 来源: 待购单品（new_item）'}

${isWardrobePairingIntent(intent) ? WARDROBE_PAIRING_SEARCH_ADDENDUM : PURCHASE_PAIRING_SEARCH_ADDENDUM}
`
    : '';

  const prompt = `
【今日用户时尚档案】
- 风格偏好: ${profile.preferences.join(', ') || '未提供'}
- 肤色: ${profile.skin_tone || '未分析'}
- 身材: ${profile.body_shape || '未分析'}
- 个人风格: ${profile.personal_style || '未分析'}

【今日穿搭意图】
- 请求类型: ${intent.request_type}
- 天气: ${intent.weather}
- 场合: ${intent.occasion}
- 风格: ${intent.style_preference}
- 特殊要求: ${intent.special_requests || '无'}
${pairingBlock}
【用户当前消息】
${userMessage || '（无文字，请根据对话历史推断）'}

【检索策略提示】
${
  isPairing
    ? `- 当前为【待购单品搭配】：只为互补槽位检索衣橱单品，围绕锚定单品「${anchorItem.name}」找搭配。${
        anchorItem.slot === 'accessory'
          ? '锚定为配饰：必须输出 top、bottom、shoes 三条 query。'
          : ''
      }`
    : `- 若用户要「一套」穿搭：按槽位检索（上装 + 下装 + 鞋，视天气加外套），不要混搭裤装与连衣裙路线。
- 若场合需要点缀或用户提及配饰：额外加 1 条 accessory 槽位 query。`
}

请输出衣橱检索 query 列表：
`;

  const contents: Content[] = [...history, { role: 'user', parts: [{ text: prompt }] }];

  const response = await withRetryOn429(
    () =>
      genAI.models.generateContent({
        model: AGENT_MODELS.stylist,
        contents,
        config: {
          systemInstruction: isPairing
            ? `${WARDROBE_SEARCH_INSTRUCTION}\n${
                isWardrobePairingIntent(intent)
                  ? WARDROBE_PAIRING_SEARCH_ADDENDUM
                  : PURCHASE_PAIRING_SEARCH_ADDENDUM
              }`
            : WARDROBE_SEARCH_INSTRUCTION,
          temperature: 0.3,
          responseMimeType: 'application/json',
          responseSchema: wardrobeSearchSchema,
        },
      }),
    { label: 'Stylist wardrobe search' }
  );

  const responseText = response.text;
  if (!responseText) {
    throw new Error('Empty wardrobe search response from Stylist Agent');
  }

  const parsed = JSON.parse(responseText) as {
    wardrobe_search_queries: Array<{ slot?: string; query?: string }>;
  };
  let queries: WardrobeSearchQuery[] = parsed.wardrobe_search_queries
    .map((item) => ({
      slot: parseWardrobeSearchSlot(item.slot),
      query: item.query?.trim() ?? '',
    }))
    .filter((item) => item.query.length > 0);

  if (isPairing && anchorItem) {
    queries = filterQueriesExcludingAnchorSlot(queries, anchorItem.slot);
  }

  console.log('[STYLIST_AGENT] Wardrobe search queries:', queries);
  return queries;
}

/**
 * 调用 Stylist Agent 生成穿搭方案
 */
export async function callStylistAgent(
  history: Content[],
  intent: GatekeeperIntent,
  profile: UserProfileResult,
  initialParts: Part[],
  clientId?: string,
  ragCache?: Map<string, ClothingItem>,
  conversationId?: string,
  options: StylistAgentOptions = {}
): Promise<StylistResult> {
  console.log('[STYLIST_AGENT] Generating styling recommendations...');

  const isRevision = intent.request_type === 'feedback_revision';
  const resolvedAnchor = getResolvedAnchorFromIntent(intent);
  const anchorItem: AnchorItemInfo | null = resolvedAnchor
    ? {
        name: resolvedAnchor.name,
        summary: resolvedAnchor.summary,
        slot: resolvedAnchor.slot,
        imageData: resolvedAnchor.imageData,
      }
    : null;

  if (isPurchasePairingIntent(intent) && !anchorItem) {
    throw new Error('PurchasePairingMissingAnchor: Gatekeeper 未提供有效的锚定单品，无法生成搭配方案');
  }
  if (isWardrobePairingIntent(intent) && !intent.anchor_wardrobe_id?.trim()) {
    throw new Error('WardrobePairingMissingAnchor: Gatekeeper 未确认衣橱锚定单品');
  }
  if (anchorItem) {
    console.log('[STYLIST_AGENT] Anchor item (from Gatekeeper):', anchorItem);
  }

  const previousCache = options.previousStylistCache;
  const revisionOutfitId = intent.selected_outfit_id?.trim() || 'outfit_1';
  const previousOutfit =
    isRevision && previousCache
      ? previousCache.stylist_result.outfits.find((o) => o.id === revisionOutfitId) ??
        previousCache.stylist_result.outfits[0]
      : undefined;

  let wardrobeXml = '';
  if (clientId && ragCache && !isRevision) {
    try {
      const userMessage = extractUserMessage(initialParts);
      console.log('[STYLIST_AGENT] Triggering internal RAG search...');
      const searchQueries = await planWardrobeSearchQueries(
        history,
        intent,
        profile,
        userMessage,
        anchorItem
      );
      const searchResults = await performRagSearch(searchQueries, clientId, ragCache, {
        source: 'stylist-agent',
        conversationId,
        userMessage,
        intent,
        anchorItem: anchorItem ?? undefined,
      });
      wardrobeXml = searchResults.xmlString;
    } catch (ragError) {
      console.warn('[STYLIST_AGENT] RAG search failed, proceeding with empty wardrobe:', ragError);
    }
  }

  const hasVisualProfile = profileHasVisualData(profile);
  const wardrobeAnchorId = isWardrobePairingIntent(intent) ? intent.anchor_wardrobe_id : undefined;
  const anchorBlock =
    anchorItem != null
      ? isWardrobePairingIntent(intent) && wardrobeAnchorId
        ? `
【衣橱锚定单品 — 每套方案必须包含】
- id: ${wardrobeAnchorId}（衣橱真实 id，禁止改为 new_item）
- name: ${anchorItem.name}
- layer: ${anchorSlotToLayer(anchorItem.slot)}
- 描述: ${anchorItem.summary}
`
        : `
【待购锚定单品 — 每套方案必须包含】
- id: "new_item"（固定）
- name: ${anchorItem.name}
- layer: ${anchorSlotToLayer(anchorItem.slot)}
- 描述: ${anchorItem.summary}
`
      : '';

  const revisionBlock =
    isRevision && previousOutfit
      ? `
【反馈微调模式 — 必须遵守】
- 目标方案 id: ${revisionOutfitId}（${outfitIdToLabel(revisionOutfitId)}）
- 用户修改要求: ${intent.special_requests || '无'}
- 上一轮方案 JSON（在此基础上修改，未提及单品 id 保持不变）:
${JSON.stringify(previousOutfit, null, 2)}
- 【只输出 1 套】，id 必须为 ${revisionOutfitId}
`
      : isRevision
        ? `
【反馈微调模式】
- 目标方案 id: ${revisionOutfitId}
- 用户修改要求: ${intent.special_requests || '无'}
- 请结合历史对话中的上一轮方案进行精准修改，【只输出 1 套】
`
        : '';

  const contextPrompt = `
【今日用户时尚档案】
- 姓名: ${profile.name || '未提供'}
- 身高: ${profile.height || '未提供'}
- 体重: ${profile.weight || '未提供'}
- 风格偏好: ${profile.preferences.join(', ') || '未提供'}
- 肤色属性: ${profile.skin_tone || '未分析'}
- 身材属性: ${profile.body_shape || '未分析'}
- 个人风格定位: ${profile.personal_style || '未分析'}
- 视觉特征: 发色为 ${profile.visual_features.hair_color}，其他特征: ${profile.visual_features.detected_features}
- 可靠外形数据: ${hasVisualProfile ? '有（可结合肤色身材绘图）' : '无（禁止编造模特外形）'}

【今日穿搭意图】
- 请求类型: ${intent.request_type}
- 天气温度: ${intent.weather}
- 场合: ${intent.occasion}
- 风格偏好: ${intent.style_preference}
- 特殊要求: ${intent.special_requests || '无'}
${anchorBlock}${revisionBlock}
【用户衣橱单品列表 (RAG 检索结果 — 互补单品)】
${wardrobeXml || (isRevision && previousCache ? '*(微调模式：优先复用上一轮方案中的衣橱单品 id)*' : '*(用户衣橱为空，请推荐全新单品)*')}
`;

  const chat = genAI.chats.create({
    model: AGENT_MODELS.stylist,
    history: history.length > 0 ? history : undefined,
    config: {
      systemInstruction: STYLIST_SYSTEM_INSTRUCTION,
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: stylistSchema,
    },
  });

  try {
    const response = await withRetryOn429(
      () => chat.sendMessage({ message: contextPrompt }),
      { label: 'Stylist' }
    );
    const responseText = response.text;

    if (!responseText) {
      throw new Error('Empty response from Stylist Agent');
    }

    console.log('[STYLIST_AGENT] Raw response:', responseText);
    const parsed = JSON.parse(responseText) as StylistResult;
    if (anchorItem?.imageData) {
      parsed.anchor_item_image_data = anchorItem.imageData;
    }
    return parsed;
  } catch (error) {
    console.error('[STYLIST_AGENT] Error calling Stylist Agent:', error);
    throw error;
  }
}
