import { Type, Schema } from '@google/genai';

export interface WeatherLookup {
  needed: boolean;
  city: string;
}

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
            '用户明确说出的特殊要求（遮肚子、显腿长等）；purchase_pairing 时填写待购单品搭配说明；style_advice 时【必须】结合历史对话，填入用户最初真正想了解的建议主题（如「高级感色彩搭配公式」「美拉德风穿搭要点」），不要因后续补充场合而丢失原始诉求。【关键】忠实还原用户的提问层级和语气，禁止自行添加「进阶」「深度」等拔高修饰词——用户问「大地色有哪些颜色？」只填「大地色的颜色构成」，用户说「啊 原来分这么多种？」只填「大地色子系列的构成与区别」；只有当用户原话中明确出现「进阶」「深入」「详细」「高阶」等词才允许加"进阶"定性。禁止臆测身材修饰需求。',
        },
        request_type: {
          type: Type.STRING,
          description:
            '请求类型：wardrobe_outfit（从衣橱搭一套）| wardrobe_pairing（指定衣橱已有单品作锚点）| purchase_pairing（待购/上传单品+衣橱互补）| feedback_revision（对上一轮方案的明确修改）| style_advice（咨询某风格/场景的穿搭建议，如「想了解X风格」「有什么好建议」，偏知识/建议而非直接要一套）| outfit_selection（仅表示更喜欢第几套，未说满意或微调）| outfit_confirmed（已选定且明确表示满意、不用调整、可直接穿）| clarify（与搭配相关但意图不清，需追问）',
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
            '本轮搭配的穿衣气候，供衣橱检索过滤：cold（秋冬保暖，如滑雪、毛呢大衣、羽绒服）| warm（春夏轻薄，如海边、徒步、短裤吊带）| mild（过渡季或室内通勤、场合未明示冷暖）。进入搭配流程（is_complete=true 的 wardrobe_outfit / wardrobe_pairing / purchase_pairing / feedback_revision）时必须填写；style_advice 可填 mild 或留空。综合锚点单品、场合、用户提到的天气/季节判断，勿留空。',
        },
      },
      required: [
        'weather',
        'city',
        'occasion',
        'style_preference',
        'special_requests',
        'request_type',
        'anchor_item_summary',
        'wardrobe_search_query',
        'anchor_slot',
        'selected_outfit_id',
        'anchor_wardrobe_id',
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
            '本轮搭配是否需要补充实时天气：wardrobe_outfit / feedback_revision 通常 true；purchase_pairing / style_advice / outfit_selection / clarify 通常 false；用户已自述天气或温度时填 false。',
        },
        city: {
          type: Type.STRING,
          description: '需要查询天气的城市（用户提到则填）；未知则填空字符串，系统会用 IP 兜底。',
        },
      },
      required: ['needed', 'city'],
    },
    followup_questions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        '当 is_complete=false 且缺少场合/锚定单品等结构化信息时，用于追问的问题列表。当 is_complete=true 时必须为空数组。',
    },
  },
  required: ['is_complete', 'extracted_intent', 'gatekeeper_reply', 'weather_lookup', 'followup_questions'],
};
