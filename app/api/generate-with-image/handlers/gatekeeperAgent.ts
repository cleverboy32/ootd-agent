import { Content, Part, Schema, Type } from '@google/genai';
import { genAI } from '@/server/services/ai';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import {
  GatekeeperIntent,
  enrichIntentFromContext,
  enrichIntentWeather,
  extractTextFromParts,
  extractUserTextFromHistory,
  normalizeGatekeeperIntent,
  finalizeGatekeeperResult,
} from './intentTypes';
import { evaluateGatekeeperOutput } from '@/server/utils/gatekeeperEvaluator';
import { logGatekeeperAudit } from '@/server/services/gatekeeperAuditLogger';
import { resolveWardrobeAnchor } from '@/server/services/gatekeeperWardrobeResolver';
import type { WardrobeAnchorCandidate } from './intentTypes';

interface WeatherLookup {
  needed: boolean;
  city: string;
}

const gatekeeperSchema: Schema = {
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
      items: {
        type: Type.STRING,
      },
      description:
        '当 is_complete=false 且缺少场合/锚定单品等结构化信息时，用于追问的问题列表。当 is_complete=true 时必须为空数组。',
    },
  },
  required: ['is_complete', 'extracted_intent', 'gatekeeper_reply', 'weather_lookup', 'followup_questions'],
};

const GATEKEEPER_SYSTEM_INSTRUCTION = `
你是一个严格、专业且亲切的时尚前台把关人 (Gatekeeper Agent)，是整个搭配系统的【入口】。
你的任务是先判断用户当前意图，再决定是否放行进入搭配流程；当请求与搭配相关但意图不清晰时，你要【亲自追问】，而不是贸然进入搭配。

【请求类型 request_type】
必须先判断用户属于哪一种：
1. wardrobe_outfit：用户要从【已有衣橱】搭配一套穿搭（无特定锚定单品）。
2. wardrobe_pairing：用户明确指定【衣橱里已有】的某件单品想穿出门（如「我衣橱那条绿色裙子」「想穿我的白色衬衫」）——用该衣橱单品作锚点，从衣橱找互补单品。【禁止】归为 purchase_pairing 或 clarify。
3. purchase_pairing：用户上传了【待购/非衣橱】服装单品图，或明确说「想买/打算买/这件能搭吗」——核心是用待购单品作锚点。【禁止】用于衣橱已有单品。
4. feedback_revision：用户对上一轮方案提出【明确修改】（如「第一套太正式了，换成裤装」「鞋换成白色」「不要红色外套」）——放行，交搭配师微调。
5. outfit_selection：用户【仅表示】更喜欢/选定上一轮的某一套（如「我比较喜欢第一套」「就第二套吧」），但【没有说明】是已满意、还是想再微调——不要放行，由你在 gatekeeper_reply 中确认并追问。
6. outfit_confirmed：用户在选定某套后，明确表示【已满意、不用调整、可以直接穿】——归类为 outfit_confirmed，【禁止】归为 outfit_selection；【禁止】再次追问是否微调；gatekeeper_reply 亲切确认定稿即可。
7. clarify：用户输入与搭配/穿衣相关，但意图模糊、信息不足以归入以上任何一类——不要放行，由你在 gatekeeper_reply 中亲切追问。
8. style_advice：用户在【咨询某种风格、色彩、场景或穿搭方法的建议/知识】，而非直接要你立刻搭一套（如「高级感色彩搭配公式」「哪些颜色适合搭在一起」「显瘦有什么技巧」「美拉德风怎么穿」）。

【style_advice 处理（重要）】
- style_advice 是【知识/建议回答】类型，不需要搭配方案。有可回答主题（咨询风格、色彩、穿搭方法等）就直接放行（is_complete=true），由 Stylist 以建议模式回答。
- 不要为了回答建议类问题而追问场合。用户问「高级感色彩搭配公式」「哪些颜色适合搭配」时，直接归为 style_advice，让 Stylist 直接回答公式、颜色组合和避坑。
- 如果用户只是补充场合（如「职场通勤」「日常百搭」），仍然保持 style_advice；occasion 填该场景，special_requests 继续保留原始知识诉求，让 Advice Agent 讲“这个公式在该场景怎么用”。
- 只有用户表达了【想看实际搭配效果 / 想把建议落实成穿搭示范】的意图时，才不要归为 style_advice；应归为 wardrobe_outfit（无特定锚点）或 wardrobe_pairing（有指定单品）。判断依据是意图，不依赖特定措辞——"给我搭一套""能变出什么魔法""想看看效果""用我的衣橱示范一下"都属于此类。此时 special_requests 中应继承刚才建议的核心主题（如「按高级感大地色系公式搭配」），让搭配师知道风格方向；occasion 若未明确则默认「日常百搭」。
- 【贯穿原始诉求（关键）】：多轮咨询里，用户最初问的可能是某个知识点（如「高级感色彩搭配公式」），后续只是补充了场合（如「职场通勤」）。你【必须】从历史对话提取用户最初真正想了解的主题，写入 special_requests。occasion 只是落地场景，禁止丢掉原始主题。
- style_advice 不需要锚定单品、天气或穿衣气候；weather_lookup.needed 填 false。

【outfit_selection 话术（重要）】
- gatekeeper_reply 必须【简短】：一句确认选了哪套 + 一个选择题（满意 or 微调）。
- 【禁止】堆砌赞美（如「非常衬气质」「清新又知性」），禁止书信腔。

【wardrobe_pairing 处理（重要）】
- anchor_item_summary 填用户描述的衣橱单品（如「绿色裙子」）；anchor_slot 填对应槽位。
- 若用户已点选确认（消息含 id=xxx），填 anchor_wardrobe_id。
- 若缺场合，is_complete=false，gatekeeper_reply 或 followup_questions 追问场合；服务端会自动检索衣橱确认单品。
- 不要因缺天气拦截 wardrobe_pairing。

【purchase_pairing 放行标准（重要）】
- outfit_selection：只说喜欢第几套，还没表态要不要改。例：「我选第一套」「更喜欢第二套」。
- outfit_confirmed：已表态满意/定稿/不用改。例：「我很满意不用调整」「就这套」「可以了直接穿」「不用改了」。
- 若用户说「满意」「不用调整」「不用改」，一律 outfit_confirmed，绝不可 outfit_selection。

【outfit_selection vs outfit_confirmed（极易混淆，务必区分）】
- 你具备多模态能力，必须亲自从【历史对话中的服装图片】或【用户文字】识别锚定单品，填入 anchor_item_summary 和 anchor_slot。
- anchor_item_summary 示例：「蓝白细条纹棉质衬衫，宽松版型」→ anchor_slot=top；「金色圆环耳环，铆钉细节」→ anchor_slot=accessory。
- anchor_slot 必须是 top | bottom | dress | shoes | outerwear | accessory 之一。
- 【重要】耳环、耳钉、项链、手链、戒指、手表、包、腰带、围巾、帽子等配饰类单品，anchor_slot 必须填 accessory，禁止填 top。
- 场合要求放宽：用户说「平时/百搭/日常/都可以穿」即视为场合足够，occasion 填「日常百搭」。
- 只有完全无法从图片或文字识别锚定单品时，才 is_complete=false 并追问。
- special_requests 填：用户待购单品（xxx）需作为搭配锚点，从衣橱选取互补单品与之搭配。
- 不要因为缺少天气拦截 purchase_pairing。

【wardrobe_outfit 放行标准】
- 通常需要明确场合（上班、约会、徒步等）才可放行。
- 但有以下情况可直接以「日常百搭」放行，无需追问场合：
  ① 用户说「平时/百搭/日常/都可以穿/随便穿」等宽泛场合词；
  ② 历史对话中存在建议类（style_advice）交流，且用户本轮的意图是【想看建议的实际效果 / 想把刚才的知识落实成穿搭示范】——无论用什么措辞（"给我搭一套" "帮我配一套" "想看看效果" "能变出什么" "实践一下" "用衣橱示范" 等），都直接判定为衣橱穿搭请求，occasion 填「日常百搭」，直接放行，【禁止】再追问场合。
- 上述两种情况以外，场合不明确时 is_complete=false，亲切追问 1-2 个问题。

【feedback_revision】
- is_complete=true，request_type=feedback_revision，从上下文继承场合，special_requests 写入用户的修改要求。
- selected_outfit_id【禁止臆测】：仅当用户本轮或历史中明确说了「第一套/第二套/outfit_1/outfit_2」时填写；若用户只说修改指令（如「去掉外套」「鞋换成高跟鞋」）而未指明哪套，selected_outfit_id 必须留空，系统会追问选套。

【天气与城市（不参与放行，但由你决策是否查询）】
- 不要因缺少天气或温度信息而拦截用户。
- 若用户主动提到天气/温度，提取到 extracted_intent.weather；若主动提到城市，提取到 extracted_intent.city。
- 由你判断本轮搭配是否需要实时天气，并填写 weather_lookup：
  - weather_lookup.needed：wardrobe_outfit / feedback_revision 这类要真正出穿搭、受冷暖影响的，填 true；style_advice / outfit_selection / outfit_confirmed / clarify / purchase_pairing 这类一般填 false；用户已自述天气/温度时填 false。
  - weather_lookup.city：需要查询时填用户提到的城市；未知则留空字符串，系统会用 IP 兜底。
- 系统会在你返回后据 weather_lookup 串行查询并补全天气结果，你无需填写查询结果本身。

【穿衣气候 dressing_climate（进入搭配流程时必填）】
- 当 is_complete=true 且 request_type 为 wardrobe_outfit / wardrobe_pairing / purchase_pairing / feedback_revision 时，必须填写 dressing_climate：cold | warm | mild。
- 综合【锚点单品 + 场合 + 用户提到的天气/季节】判断本轮应选什么厚度的单品，不要被无关历史带偏。
  - cold：冬季、滑雪、毛呢/羽绒/厚外套锚点、用户明确要保暖。
  - warm：海边、夏日、徒步轻装、短裤吊带等轻薄场景。
  - mild：室内通勤、过渡季、用户未明示冷暖且锚点无强烈季节属性。
- 例：锚点为「冬季灰色长毛呢外套」+ 上班通勤 → dressing_climate=cold（即使用户本轮只说「确认选择 id=xxx」）。
- outfit_selection / outfit_confirmed / clarify 等短路类型可填 mild 或留空字符串。

【严格提取，禁止臆测】
- style_preference：仅当用户明确提到风格词时填写；否则填 "日常休闲"。
- city：仅提取用户明确提到的城市；未提及则填 ""。
- anchor_item_summary / anchor_slot：purchase_pairing / wardrobe_pairing 时填写；识别服装图时请描述颜色、品类、材质，不要描述模特外貌。

【工作流程】
1. 仔细阅读用户当前输入及历史对话（含历史中的服装图片）。
2. 判定 request_type；衣橱已有单品 → wardrobe_pairing；意图不清晰时归为 outfit_selection 或 clarify，不要硬猜。
3. 可放行（wardrobe_outfit / wardrobe_pairing / purchase_pairing / feedback_revision 且信息齐全）→ is_complete=true，gatekeeper_reply 留空。
4. style_advice → 有明确建议主题则 is_complete=true，由 Stylist 以建议模式回答；主题完全不明确时才 is_complete=false 并用 gatekeeper_reply 追问。
5. 不可放行 → is_complete=false：结构化信息缺失用 followup_questions；意图需澄清（outfit_selection / clarify）用 gatekeeper_reply 直接回复。
`;

export interface GatekeeperContext {
  clientIp?: string;
  profileLocation?: string;
  clientId?: string;
}

export interface GatekeeperAuditMeta {
  conversationId?: string;
  messageId?: string;
}

export interface GatekeeperResult {
  is_complete: boolean;
  extracted_intent: GatekeeperIntent;
  followup_questions: string[];
  /** outfit_selection / outfit_confirmed / clarify 时由 Gatekeeper 直接回复用户的话术 */
  gatekeeper_reply?: string;
  /** Gatekeeper 决策本轮是否查询天气及目标城市（仅服务端使用） */
  weather_lookup?: WeatherLookup;
  /** wardrobe_pairing 检索到多件相似单品时的候选列表 */
  wardrobe_candidates?: WardrobeAnchorCandidate[];
}

function buildContextText(history: Content[], currentInput: Part[]): string {
  return `${extractUserTextFromHistory(history)}\n${extractTextFromParts(currentInput)}`.trim();
}

async function finalizeGatekeeperIntent(
  intent: GatekeeperIntent,
  history: Content[],
  currentInput: Part[],
  ctx: GatekeeperContext,
  weatherLookup?: WeatherLookup
): Promise<{ intent: GatekeeperIntent; suggestCityForWeather: boolean }> {
  const contextText = buildContextText(history, currentInput);
  let enriched = enrichIntentFromContext(intent, history, currentInput);

  // 天气由 Gatekeeper LLM 决策（weather_lookup.needed）；服务端在此串行查询补全
  if (weatherLookup?.needed && !enriched.weather.trim()) {
    if (weatherLookup.city?.trim()) {
      enriched = { ...enriched, city: weatherLookup.city.trim() };
    }
    enriched = await enrichIntentWeather(enriched, {
      clientIp: ctx.clientIp,
      profileLocation: ctx.profileLocation,
      contextText,
    });
  }

  const suggestCityForWeather = Boolean(weatherLookup?.needed) && !enriched.weather.trim();
  return { intent: enriched, suggestCityForWeather };
}

/**
 * 调用 Gatekeeper Agent 评估用户请求。
 * 单次 LLM 调用即完成意图判定与天气决策；天气在 LLM 返回后按 weather_lookup 串行查询，不参与放行。
 */
export async function callGatekeeperAgent(
  history: Content[],
  currentInput: Part[],
  ctx: GatekeeperContext = {},
  auditMeta?: GatekeeperAuditMeta
): Promise<GatekeeperResult> {
  console.log('[GATEKEEPER_AGENT] Evaluating user request...');

  const contents: Content[] = [...history, { role: 'user', parts: currentInput }];

  try {
    const response = await withRetryOn429(
      () =>
        genAI.models.generateContent({
          model: AGENT_MODELS.gatekeeper,
          contents,
          config: {
            systemInstruction: GATEKEEPER_SYSTEM_INSTRUCTION,
            temperature: 0.0,
            responseMimeType: 'application/json',
            responseSchema: gatekeeperSchema,
          },
        }),
      { label: 'Gatekeeper', maxRetries: 4 }
    );

    const responseText = response.text;
    if (!responseText) {
      throw new Error('Empty response from Gatekeeper Agent');
    }

    console.log('[GATEKEEPER_AGENT] Raw response:', responseText);

    const parsed = JSON.parse(responseText) as GatekeeperResult;
    const { intent, suggestCityForWeather } = await finalizeGatekeeperIntent(
      normalizeGatekeeperIntent(parsed.extracted_intent),
      history,
      currentInput,
      ctx,
      parsed.weather_lookup
    );

    let wardrobeResolver;
    if (
      intent.request_type === 'wardrobe_pairing' &&
      ctx.clientId &&
      intent.anchor_item_summary.trim() &&
      !intent.anchor_wardrobe_id?.trim()
    ) {
      wardrobeResolver = await resolveWardrobeAnchor(
        ctx.clientId,
        intent.anchor_item_summary,
        intent.anchor_slot || undefined
      );
    }

    const result = finalizeGatekeeperResult({
      extracted_intent: intent,
      followup_questions: parsed.followup_questions,
      gatekeeper_reply: parsed.gatekeeper_reply,
      suggestCityForWeather,
      wardrobeResolver,
      currentMessageText: extractTextFromParts(currentInput),
      history,
      modelIsComplete: parsed.is_complete,
    });

    const contextText = buildContextText(history, currentInput);
    const l1 = evaluateGatekeeperOutput(
      {
        ...result,
        wardrobe_candidates: result.wardrobe_candidates,
      },
      {
        contextText,
        currentMessageText: extractTextFromParts(currentInput),
        weatherLookup: parsed.weather_lookup,
      }
    );
    void logGatekeeperAudit({
      timestamp: new Date().toISOString(),
      conversationId: auditMeta?.conversationId,
      messageId: auditMeta?.messageId,
      contextTextLength: contextText.length,
      requestType: result.extracted_intent.request_type,
      is_complete: result.is_complete,
      gatekeeper_reply: result.gatekeeper_reply,
      followup_questions: result.followup_questions,
      extracted_intent: result.extracted_intent,
      weather_lookup: parsed.weather_lookup,
      wardrobe_candidates: result.wardrobe_candidates,
      l1,
    });

    return {
      ...result,
      weather_lookup: parsed.weather_lookup,
    };
  } catch (error) {
    console.error('[GATEKEEPER_AGENT] Error calling Gatekeeper Agent:', error);
    throw error;
  }
}
