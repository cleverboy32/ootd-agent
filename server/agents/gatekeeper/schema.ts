import { Type, Schema } from '@google/genai';

export interface WeatherLookup {
  needed: boolean;
  city: string;
}

/** Gatekeeper 抽出的长期档案增量；服务端合并写库，不阻塞搭配 */
export interface ProfileUpdatePatch {
  name: string;
  height: string;
  weight: string;
  personal_style: string;
  preference_additions: string[];
}

export interface ProfileUpdate {
  needed: boolean;
  patch: ProfileUpdatePatch;
}

export const EMPTY_PROFILE_UPDATE_PATCH: ProfileUpdatePatch = {
  name: '',
  height: '',
  weight: '',
  personal_style: '',
  preference_additions: [],
};

export const gatekeeperSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    is_complete: {
      type: Type.BOOLEAN,
      description:
        '是否可进入搭配生成流程。wardrobe_outfit 需场合明确；purchase_pairing 需锚定单品；feedback_revision 有明确修改指令时为 true；style_advice 有可回答主题（如咨询风格、色彩、穿搭方法等）时填 true，由 Stylist 以建议模式回答；主题完全不明确时才填 false；outfit_selection / outfit_confirmed / clarify 意图不明或已定稿，填 false，由 gatekeeper_reply 直接回复用户。',
    },
    extracted_intent: {
      type: Type.OBJECT,
      properties: {
        weather: {
          type: Type.STRING,
          description: '用户主动提到的天气或温度（如：15度、下雨）。未提及则填空字符串。',
        },
        city: {
          type: Type.STRING,
          description: '用户主动提到的城市名。未提及则填空字符串。',
        },
        city_role: {
          type: Type.STRING,
          description:
            '本轮 city 的语义角色。home：用户在说明常住/所在城市（含回答「您在哪个城市」类追问、说「我在X」）；travel：旅游、出差、短途出行等目的地（如「去X玩/出差」）。city 为空时必须填空字符串。禁止把出行目的地标成 home。',
        },
        occasion: {
          type: Type.STRING,
          description: '穿搭场合。若信息不全，此项填空字符串。',
        },
        style_preference: {
          type: Type.STRING,
          description:
            '用户原文中明确说出的风格偏好（如：温柔风、美式复古、松弛感）。禁止根据场合臆测风格。用户未提及则填 "日常休闲"。',
        },
        special_requests: {
          type: Type.STRING,
          description:
            '用户明确说出的特殊要求。purchase_pairing 时填写待购单品搭配说明。style_advice 时结合历史对话保留最初的知识主题，不要因后续补充场合丢掉它，也不要自行拔高成用户没说的程度。wardrobe_outfit 且用户要买新品或看新品时，记下季节、新品和风格，不要改写成建议清单。禁止臆测身材修饰需求。',
        },
        request_type: {
          type: Type.STRING,
          description:
            '请求类型：wardrobe_outfit（要看到一套造型，含推荐穿搭、想买衣服、想看新品）| wardrobe_pairing（指定衣橱已有单品作锚点）| purchase_pairing（待购/上传单品+衣橱互补）| feedback_revision（对上一轮方案的明确修改）| style_advice（只咨询穿搭知识：方法、公式、颜色怎么配、某风格怎么穿）| outfit_selection（仅表示更喜欢第几套，未说满意或微调）| outfit_confirmed（已选定且明确表示满意、不用调整、可直接穿）| clarify（与搭配相关但意图不清，需追问）',
        },
        selected_outfit_id: {
          type: Type.STRING,
          description:
            'outfit_selection / outfit_confirmed 时填用户选中的 outfit_1 或 outfit_2。feedback_revision 时【仅当用户本轮或历史中明确说了第一套/第二套/outfit_1/outfit_2】才填写；若用户只说修改内容（如「去掉外套」）而未选套，必须填空字符串，由系统追问。其他类型填空字符串。',
        },
        anchor_wardrobe_id: {
          type: Type.STRING,
          description:
            'wardrobe_pairing 时：用户已确认的衣橱单品 id（用户点选候选或明确指定）。未确认则填空，由服务端检索。',
        },
        session_item_id: {
          type: Type.STRING,
          description:
            'purchase_pairing：填写【会话待购单品】清单中的 id（如 si_1）。用户指代历史某张上传图时选对应 id；本轮新上传且未指代旧图时选清单最后一项。feedback_revision 必须填空字符串。其他类型填空字符串。',
        },
        anchor_item_summary: {
          type: Type.STRING,
          description:
            'purchase_pairing / wardrobe_pairing 时：锚定单品描述（颜色+品类+关键特征）。其他类型填空字符串。',
        },
        wardrobe_search_query: {
          type: Type.STRING,
          description:
            'wardrobe_pairing 专用：用于衣橱语义检索的精简关键词（颜色 + 品类），如「白色连衣裙」「浅蓝牛仔裤」「米白衬衫」。读完整段对话历史后，以用户最终希望找到/穿到的单品为准填写，不是用户用来描述错误结果的词，也不是系统误返单品的颜色。其他类型填空字符串。',
        },
        anchor_slot: {
          type: Type.STRING,
          description:
            'purchase_pairing / wardrobe_pairing 时锚定单品的穿搭槽位：top | bottom | dress | shoes | outerwear | accessory。耳环、项链、手链、戒指、包、腰带、围巾、帽子等必须填 accessory，禁止填 top。',
        },
        dressing_climate: {
          type: Type.STRING,
          description:
            '留空字符串。穿衣气候由服务端在查完天气后根据温度与锚点单品自动计算，禁止 Gatekeeper 自行填写。',
        },
      },
      required: [
        'weather',
        'city',
        'city_role',
        'occasion',
        'style_preference',
        'special_requests',
        'request_type',
        'anchor_item_summary',
        'wardrobe_search_query',
        'anchor_slot',
        'selected_outfit_id',
        'anchor_wardrobe_id',
        'session_item_id',
        'dressing_climate',
      ],
    },
    gatekeeper_reply: {
      type: Type.STRING,
      description:
        '当 is_complete=false 且 request_type 为 outfit_selection / outfit_confirmed / clarify 时，用亲切时尚顾问口吻【直接回复用户】的完整话术。outfit_selection 含追问；outfit_confirmed 仅确认定稿、禁止再追问微调。其他情况填空字符串。',
    },
    weather_lookup: {
      type: Type.OBJECT,
      properties: {
        needed: {
          type: Type.BOOLEAN,
          description:
            '本轮回复是否依赖实时天气，与 request_type 无关。用户主动询问天气、或问今天明天某次出行怎么穿时为 true。为还没到的季节买衣服或准备衣橱时为 false。与天气无关、或用户已自述天气温度时为 false。',
        },
        city: {
          type: Type.STRING,
          description: '用户明确提到、且本轮要查天气的城市；未提及填空字符串，系统会依次用用户档案常住城市、IP 兜底。禁止猜测。',
        },
      },
      required: ['needed', 'city'],
    },
    profile_update: {
      type: Type.OBJECT,
      description:
        '本轮是否含应写入【长期时尚档案】的信息。系统会异步合并写库，不阻塞搭配。只记录跨对话仍成立的稳定信息。',
      properties: {
        needed: {
          type: Type.BOOLEAN,
          description:
            '本轮是否需要更新长期档案。true：明确自我介绍姓名、身高体重、一贯风格偏好等；false：纯场合/单次想穿什么/选套/确认/微调/衣橱浏览/待购搭配。outfit_selection / outfit_confirmed / clarify / feedback_revision 通常 false。',
        },
        patch: {
          type: Type.OBJECT,
          description: '增量字段；未提及的项填空字符串或空数组，禁止把本轮场合/单次单品意图写入 preference_additions。',
          properties: {
            name: {
              type: Type.STRING,
              description: '仅用户明确自我介绍时填写；否则空字符串。',
            },
            height: {
              type: Type.STRING,
              description: '用户明确说出的身高；未提及填空字符串。',
            },
            weight: {
              type: Type.STRING,
              description: '用户明确说出的体重；未提及填空字符串。',
            },
            personal_style: {
              type: Type.STRING,
              description: '用户明确说出的长期风格定位；未提及填空字符串。禁止根据场合臆测。',
            },
            preference_additions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description:
                '本轮新出现的【长期】穿衣偏好条目（可追加多条）。禁止写入场合、单次搭配请求、操作确认。无则空数组。',
            },
          },
          required: ['name', 'height', 'weight', 'personal_style', 'preference_additions'],
        },
      },
      required: ['needed', 'patch'],
    },
    followup_questions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        '当 is_complete=false 且缺少场合/锚定单品等结构化信息时，用于追问的问题列表。当 is_complete=true 时必须为空数组。',
    },
  },
  required: [
    'is_complete',
    'extracted_intent',
    'gatekeeper_reply',
    'weather_lookup',
    'profile_update',
    'followup_questions',
  ],
};
