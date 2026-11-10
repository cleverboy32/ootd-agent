import { Type, Schema } from '@google/genai';
import { llmGenerate } from '@/server/services/llm/client';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import { urlToGenerativePart } from '@/server/utils/image';

export interface VisualProfileResult {
  is_valid_portrait: boolean;
  /** 不通过时的原因代码，通过时为空 */
  portrait_issue: string;
  /** 照片中人物的性别：男 / 女；非人物照或无法判断为空 */
  gender: string;
  skin_tone: string;
  body_shape: string;
  /** @deprecated 不再由照片推断风格；恒为空，保留字段兼容落库 */
  suited_style: string;
  visual_features: {
    hair_color: string;
    detected_features: string;
  };
}

const PORTRAIT_REJECTION_MESSAGES: Record<string, string> = {
  half_body: '请至少拍到膝盖。齐胸、齐腰或只到大腿根的半身照看不出腿的比例。',
  close_up: '请把画面拉到至少膝盖。大头自拍看不全身形。',
  face_unclear: '请上传人脸清晰、至少拍到膝盖的站立照。',
  coat_covers_body: '长大衣把身形完全罩住了，请换一件日常外衣再拍。',
  not_standing: '请站立拍摄，至少拍到膝盖。',
  multiple_people: '请只拍一个人的全身照。',
  not_a_person: '请上传清晰的人物全身照。',
};

/** 把分析给出的原因代码转成上传失败文案。未知代码用通用全身照说明。 */
export function portraitRejectionMessage(issue?: string): string {
  const key = issue?.trim().toLowerCase() ?? '';
  return PORTRAIT_REJECTION_MESSAGES[key] ?? '请上传站立、至少拍到膝盖的日常人物照。';
}

const visualProfileSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    is_valid_portrait: {
      type: Type.BOOLEAN,
      description:
        '一个人站立、头顶在画面里、至少拍到膝盖、人脸可辨、双臂未挡在身前时为 true。齐胸、齐腰、只到大腿根、大头自拍、长大衣完全罩住身形、看不清脸、非人物照为 false。鞋可以不在画面里，不要求贴身。',
    },
    portrait_issue: {
      type: Type.STRING,
      description:
        'is_valid_portrait 为 true 时填空字符串。为 false 时只填一个代码：half_body、close_up、face_unclear、coat_covers_body、not_standing、multiple_people、not_a_person。',
    },
    gender: {
      type: Type.STRING,
      description:
        '照片中人物的性别，只填「男」或「女」。非人物照、多人照或无法可靠判断时填空字符串。',
    },
    skin_tone: {
      type: Type.STRING,
      description:
        '只写肤色客观说明：冷/暖/中性，深浅可带一句。禁止写适合穿什么色、忌什么色或任何搭配建议。非人物照时填空字符串。',
    },
    body_shape: {
      type: Type.STRING,
      description:
        '只写身材客观说明：能判断时给出明确类型词（梨型、苹果型、沙漏型、矩形/匀称、倒三角等）及肩腰胯相对量感。禁止写穿搭、版型、下装选什么、色彩建议。拿不准就留空，不要写「偏×型且匀称」这类含糊句。非人物照时填空字符串。',
    },
    suited_style: {
      type: Type.STRING,
      description: '已废弃：恒填空字符串。风格留给用户个人偏好与当轮点名，不由照片推断。',
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
  required: ['is_valid_portrait', 'portrait_issue', 'gender', 'skin_tone', 'body_shape', 'suited_style', 'visual_features'],
};

const VISUAL_PROFILE_SYSTEM_INSTRUCTION = `
你是一个世界顶级的时尚量体师，判断用户照片能否作为效果图的人物参考，并分析外形特征。

【有效性判定】
- is_valid_portrait = true：一个人、站立、头顶在画面里、画面至少到膝盖或小腿根、能认出五官、脸没有被挡住。鞋和脚可以不在画面里。日常衣服即可，不要求贴身。脸会比较小，只要五官可辨就通过。手机举在脸旁边且没有挡住五官，仍然通过。一只手拿手机、另一只手自然下垂，不算挡在身前。看不清精确身材类型时 body_shape 留空，仍然通过。
- is_valid_portrait = false，并在 portrait_issue 填写对应代码：
  - half_body：画面在大腿根以上就截断，看不到膝盖。到膝盖或小腿根的不要用这个代码
  - close_up：大头或肩部以上特写
  - face_unclear：五官被遮住、模糊到无法认出是一张脸，或完全背对镜头。脸小但五官可辨时不要用这个代码
  - coat_covers_body：长大衣或宽大外套把身形完全罩住
  - not_standing：没有站立
  - multiple_people：画面里不止一个人
  - not_a_person：衣物平铺、风景或其他非人物照
- 通过时 portrait_issue 填空字符串。

【分析维度】
0. 性别 (gender)：只填「男」或「女」。看面部特征、发型与整体气质综合判断；无法可靠判断或非人物照填空字符串。不要仅凭穿着判断（裙子不等于女性）。
1. 肤色 (skin_tone)：只写冷/暖/中性与深浅等客观说明。禁止写适合哪些颜色、忌哪些颜色、或任何穿搭色彩建议（搭配阶段再判断）。非人物照填空字符串。
2. 身材 (body_shape)：只写客观体型。能判断时用明确类型词（梨型、苹果型、沙漏型、矩形/匀称、倒三角等），可补一句肩/腰/胯相对量感。禁止写穿搭建议、版型建议、下装选 A 字/直筒等。看不清或只是「略偏」就留空，不要写「偏×型且匀称」这类骑墙句；不要因此判失败。
3. 外形特征 (visual_features)：发色、发型、眼镜等客观描述。
4. suited_style：恒填空字符串。不要根据照片推断适合风格；风格由用户个人偏好与当轮点名决定。

【语言要求】
所有面向用户的文字必须使用简体中文。

【安全与尊重】
- 客观专业。禁止贬低、年龄歧视、体型羞辱。
- 不推断姓名、地址等隐私信息。
- 无法分析时不编造，将 is_valid_portrait 设为 false。
`;

export async function analyzeVisualProfileFromImage(imageUrl: string): Promise<VisualProfileResult> {
  const imagePart = await urlToGenerativePart(imageUrl);

  const response = await withRetryOn429(
    () =>
      llmGenerate({
        model: AGENT_MODELS.visualCritic,
        systemInstruction: VISUAL_PROFILE_SYSTEM_INSTRUCTION,
        temperature: 0.2,
        jsonSchema: visualProfileSchema,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  '请判断这张照片能否作为人物全身参考，并只做客观外形分析：肤色说明、身材类型说明、外形特征。肤色与身材不要写穿搭或色彩建议。suited_style 填空。不要根据照片推断适合风格。',
              },
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
  const parsed = JSON.parse(responseText) as VisualProfileResult;
  // 风格不由照片推断；个人偏好留给档案 personal_style / preferences
  parsed.suited_style = '';
  return parsed;
}
