import type { ClothingMainCategory } from '@prisma/client';
import { Type, type Schema } from '@google/genai';

export const WARDROBE_FORMALITY_LEVELS = [
  'lounge',
  'athletic',
  'outdoor',
  'casual',
  'street',
  'smart-casual',
  'business',
  'formal',
] as const;

export type WardrobeFormality = (typeof WARDROBE_FORMALITY_LEVELS)[number];

export const WARDROBE_ANALYSIS_RULESET_VERSION = '2026-11-19.13';

/** LLM 分析输出；Part 1 分类字段与旧版一致，Part 2 为检索导向扩展 */
export interface WardrobeAnalysisResult {
  mainCategory: ClothingMainCategory;
  subCategory: string;
  season: string[];
  material: string[];
  colors: string[];
  tags: string[];
  description: string;
  occasions?: string[];
  formality?: string;
  silhouette?: string[];
  searchDescription?: string;
  /** 合适穿着温度下限（摄氏度）。空表示未给出下限 */
  tempMin?: number | null;
  /** 合适穿着温度上限（摄氏度）。空表示未给出上限 */
  tempMax?: number | null;
}

export interface NormalizedWardrobeAnalysis {
  mainCategory: ClothingMainCategory;
  subCategory: string;
  season: string[];
  material: string[];
  colors: string[];
  tags: string[];
  description: string;
  occasions: string[];
  formality: string | null;
  silhouette: string[];
  searchDescription: string;
  tempMin: number | null;
  tempMax: number | null;
}

// 项目对薄贴身保暖底层的叠穿参考温区。
const THERMAL_BASE_LAYER = { tempMin: -15, tempMax: 4 } as const;

export const WARDROBE_ANALYSIS_PROMPT = `你是服装识别助手。根据用户给出的衣服图片，只返回一个压缩 JSON，不要 markdown，不要解释。

自由文本全部用中文：subCategory、description、material、colors、tags、silhouette、occasions、searchDescription。
mainCategory 必须是 TOP、BOTTOM、OUTERWEAR、FOOTWEAR、ACCESSORY、SOCKS、ONE_PIECE 之一。
SOCKS 与 BOTTOM 分界：按袜型或裤型结构及典型穿法判断。丝袜、连裤袜、长筒袜、光腿神器和裙裤外露的加绒袜型腿层归 SOCKS。牛仔裤、西裤、卫裤及可独立外穿的瑜伽/运动紧身裤归 BOTTOM。穿在全长外裤里的薄平针织贴身保暖裤（如 HEATTECH、发热内衣裤、秋裤）**必须 BOTTOM**；subCategory 用「薄针织保暖长裤」等，有图中文字支持时可写「发热保暖裤」，**禁止擅自写成「打底裤/贴身打底裤」**。
ONE_PIECE 与 BOTTOM 分界：所有裙装（半身裙、连衣裙、背带裙、裙裤外观以裙为主等）→ ONE_PIECE；BOTTOM 只标裤类。禁止把半身裙标成 BOTTOM。
season 用「春、夏、秋、冬」。
formality 必须是下列之一（单选最贴一档，不要将就）：居家、运动训练、户外机能、休闲日常、街头潮酷、商务休闲、商务、正式。

总原则：tags、occasions、formality、searchDescription 都只写最匹配的点，宁少勿滥，禁止为凑数把不适合的场合或风格写进去。

贴身保暖内衣与裤内保暖层（HEATTECH/发热内衣/薄针织保暖裤）是功能性内层，不按电商模特单穿图推断为外穿单品：occasions 写「寒冷天气」「冬季通勤」等真实叠穿场景；searchDescription 明确它穿在贴身层/全长外裤里面。禁止写「可单穿」「居家单穿」「当外层」或给裤内保暖裤推荐裙装搭配。description 只描述图中可见的剪裁、颜色和针织质感，不把“发热/速干”当成肉眼可见材质，除非图片上有清晰文字标识。

1. subCategory：中文品类名，如「圆领短袖」「直筒牛仔裤」「棒球夹克」「连裤袜」。
2. season：可穿季节，取自春、夏、秋、冬。
3. material：1-2 个。优先写看得见的组织或手感（牛仔、摇粒绒、针织、府绸感梭织、运动弹力面），不要只写「聚酯纤维」却看不出是棉服壳还是训练面料。起毛、罗纹或针织不要写成棉。里布是牛仔时，材质仍写衣身的尼龙或聚酯，不要把整件标成牛仔。
4. colors：1-3 个穿着时从外面能看到的大面积颜色。领口内侧、翻起来才露出的袖口、里布、线迹、小标，以及和衣身同色的细松紧，不要记成第二种颜色。
5. tags：1-4 个中文标签，只标风格和用途里最贴的。训练/瑜伽/速干件标运动、瑜伽、健身等，禁止顺手加「休闲」「百搭」「日常」。非训练件也不要用无关标签凑数。内里不要写成镶边、拼接或撞色。
6. description：一句外观。必须写能看见的面料说话方式或纹理（如梭织衬衫感、针织柔软、摇粒绒颗粒、牛仔硬质、运动弹力）。有罗纹或起毛的有领衣服要写针织或毛呢，不要写成光滑衬衫。衣身蓬起的外套要写棉服，不要写成轻薄夹克。内里不要写成镶边或拼接。
7. occasions：1-3 个最适合的中文场合。训练件只写运动、健身、瑜伽等，禁止扩写「日常」「通勤」「约会」。保暖内衣和裤内保暖层只写寒冷天气、冬季通勤等叠穿场景，不写单穿场景。日常衬衫不要硬加派对。不要将就凑满。
8. formality：上列八档之一。瑜伽裤/运动紧身短裤/速干训练衣必须是「运动训练」，禁止标成「休闲日常」。睡袍家居是「居家」。冲锋衣徒步鞋偏「户外机能」。明显街头潮酷外形可用「街头潮酷」。干净日常出门是「休闲日常」。
9. silhouette：1-3 个中文廓形，如宽松、直筒、短款。
10. searchDescription：2-4 句中文，围绕最适合的场合写完整搭配语境（和什么类型上装/下装/鞋怎么搭、什么场景穿）。禁止一句简单带过；禁止写到不适合的场合（训练件不要写「也可日常休闲」）。保暖内衣或裤内保暖层必须写明是内搭，不得推荐单穿/当外层；裤内保暖层只搭配全长外裤。不要只重复外观，也不要把内里颜色写成可检索词。
11. tempMin、tempMax 用整数摄氏度表示这件单品在典型穿法下大致舒适的环境温度。普通上衣按独立穿着估，普通外裤和裙装按不加额外保暖腿层估。外套按搭基础内搭估，连裤袜按下文的腿层规则估。
    薄贴身秋衣、秋裤有专门的参考穿法。秋衣贴身穿在中层或外套里面，秋裤贴身穿在全长外裤里面。确认属于这类保暖底层时，tempMin 填 ${THERMAL_BASE_LAYER.tempMin}，tempMax 填 ${THERMAL_BASE_LAYER.tempMax}，表示作为底层叠穿的参考天气。
    根据图中可见的面料疏密、厚薄、覆盖长度、开衩、衬里和填充，分别估计上下限。毛呢质感说明表面纹理，厚度要另找依据；同样是长裙，轻薄透光和厚实带绒可以给出不同的范围。克重、充绒量和袜子 D 数只有在图上标明时才可采用。鞋看露肤面积、透气鞋面和可见绒里。某一侧依据不足时该侧填 null，两侧都无法判断时都填 null；配饰（非袜）两个都填 null。

补充品类识别：
- TOP 与 OUTERWEAR 按门襟结构区分：摇粒绒/抓绒套头衫、半开襟套头归 TOP；开衫或夹克有可完全敞开的门襟。棉服看衣身的蓬松填充，绗缝线本身不足以判定厚度。
- 薄贴身发热/德绒内衣：长袖同时具备宽圆领或 U 领、薄软细针织、衣身贴肤、平直无收口下摆，且没有外穿结构时，按贴身底层填写所有字段：mainCategory=TOP，subCategory 写「薄贴身保暖内衣」，温区按第 11 条的秋衣规则。description 写清可见的领口宽深、贴肤程度和下摆收口结构。领口宽深看不清时，可结合薄贴肤面料、平直无收口下摆和贴身打底用途判断。单凭宽领、修身或可叠穿均不足以定为秋衣。
- 薄贴身全长针织裤：结合贴肤剪裁、细密弹力针织以及口袋、抽绳、裤袢、反光条等结构，区分裤内保暖层与可外穿运动裤。
- 连裤袜（SOCKS）：按以下顺序判断透肤、厚薄和穿着温度。
  1. 透肤看光照相近的大腿、膝部拉伸处与周围袜面。肤色清楚可见时写「透肤」。拉伸区顺着腿部轮廓从袜面本色渐渐透出肉棕、肉粉等暖肤底色时写「微透肤」，即使看不清皮肤细节。整体暖光、仅有明暗变化、离散的花灰织纹，均不足以判断透肤。光线充足的拉伸区若能清楚确认袜面以织物本色遮住肤色，才写「不透肤」。无法确认时直接描述袜面织纹和贴合度，省略所有透肤措辞，包括「看不到透出肤色」「无明显透肤」。透出的肤色不计入 colors。若能看见肤色内衬，按内衬形成的仿透肤效果描述。
  2. 厚薄按袜层结构判断。袜面细密、平贴腿部或脚背，能看清腿部轮廓且袜层无明显增厚时，可写「薄款」或「偏薄」，透肤看不清也可这样判断。可见绒里、明显厚实的袜层或加绒标识支持厚款判断。深色、哑光、花灰和透肤程度都不能单独用来定厚薄。
  3. 温区按配裙或短裤时的腿层用途估计。袜面细密贴腿、呈薄针织外观时，按薄款描述，叠穿温区参考 10 至 16℃。羊毛、羊绒等标签只说明材质；单写「羊毛」时不推断混纺或成分比例。只有可见的厚实袜层、内绒，或明确的厚度、加绒结构、保暖等级标注，才支持把下限往更冷调整。「秋冬」「保暖」等宣传词和图中搭配的毛呢裙、外套都不计作袜层的保暖证据。description、tags 和 searchDescription 使用同一厚薄与透肤判断，搭配按腿层用途写。
- 裤裙的 subCategory 写明可见长短。格纹、硬折和蕾丝花边本身不足以判断厚度。吊带睡裙还要结合肩带、袖型与家居用途识别。
- 带状首饰（ACCESSORY）：优先根据实际佩戴部位、商品文字或可读尺寸区分贴颈的颈链和戴在手腕的手链。平铺图从一端到另一端沿饰带看完整主体，结合带长、带宽和扣件的相对比例判断；弯折摆放时两段属于同一条带，延长链不计入饰带主体。龙虾扣、延长链和刺绣在颈链和手链上都可能出现，不能单凭这些细节判断戴在手腕。整条主体比例支持贴颈佩戴时，可用「刺绣细带颈链」等中文品类名。证据不足时，用「刺绣带饰」等中性品类名，description、tags 和 searchDescription 保持一致，只写可见特点和搭配风格，不指定颈部或手腕。`

export const WARDROBE_ANALYSIS_JSON_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    mainCategory: { type: Type.STRING },
    subCategory: { type: Type.STRING },
    season: { type: Type.ARRAY, items: { type: Type.STRING } },
    material: { type: Type.ARRAY, items: { type: Type.STRING } },
    colors: { type: Type.ARRAY, items: { type: Type.STRING } },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    description: { type: Type.STRING },
    occasions: { type: Type.ARRAY, items: { type: Type.STRING } },
    formality: { type: Type.STRING },
    silhouette: { type: Type.ARRAY, items: { type: Type.STRING } },
    searchDescription: { type: Type.STRING },
    tempMin: { type: Type.INTEGER, nullable: true },
    tempMax: { type: Type.INTEGER, nullable: true },
  },
  required: ['mainCategory', 'subCategory', 'season', 'material', 'colors', 'tags', 'description'],
};

const MAIN_CATEGORY_ALIASES: Record<string, ClothingMainCategory> = {
  TOP: 'TOP',
  TOPS: 'TOP',
  SHIRT: 'TOP',
  SHIRTS: 'TOP',
  BOTTOM: 'BOTTOM',
  BOTTOMS: 'BOTTOM',
  PANTS: 'BOTTOM',
  TROUSERS: 'BOTTOM',
  JEANS: 'BOTTOM',
  OUTERWEAR: 'OUTERWEAR',
  JACKET: 'OUTERWEAR',
  COAT: 'OUTERWEAR',
  BLAZER: 'OUTERWEAR',
  FOOTWEAR: 'FOOTWEAR',
  SHOES: 'FOOTWEAR',
  SHOE: 'FOOTWEAR',
  SNEAKERS: 'FOOTWEAR',
  BOOTS: 'FOOTWEAR',
  ACCESSORY: 'ACCESSORY',
  ACCESSORIES: 'ACCESSORY',
  JEWELRY: 'ACCESSORY',
  SOCKS: 'SOCKS',
  SOCK: 'SOCKS',
  LEGWEAR: 'SOCKS',
  HOSIERY: 'SOCKS',
  TIGHTS: 'SOCKS',
  袜: 'SOCKS',
  袜子: 'SOCKS',
  ONE_PIECE: 'ONE_PIECE',
  ONEPIECE: 'ONE_PIECE',
  DRESS: 'ONE_PIECE',
  DRESSES: 'ONE_PIECE',
};

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[,;/|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function normalizeMainCategory(value: unknown): ClothingMainCategory | null {
  if (typeof value !== 'string') return null;
  const token = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (Object.values(MAIN_CATEGORY_ALIASES).includes(token as ClothingMainCategory)) {
    return token as ClothingMainCategory;
  }
  return MAIN_CATEGORY_ALIASES[token] ?? null;
}

/** 裤内薄平针织发热/速干全长保暖裤（按功能识别，不依赖「打底裤」品类名） */
export function looksLikeThermalInnerBottomPants(subCategory: string, description = ''): boolean {
  const text = `${subCategory} ${description}`;
  if (!/裤/.test(text) || /羊羔绒|光腿神器|连裤袜|袜裤/.test(text)) return false;
  if (/秋裤|保暖内衣裤|滑雪底层|内搭裤|贴身保暖裤|发热保暖裤|薄针织保暖|速干保暖裤/i.test(text)) {
    return true;
  }
  // 无明确功能词时，只兜底纯平针织全长贴身裤；具体运动/外穿结构优先排除。
  const positiveEvidence = text.replace(/(?:无|没有|不带|未见)[^，。；;]{0,12}/g, '');
  if (/瑜伽|健身|跑步|训练|骑行|口袋|抽绳|裤袢|反光|侧条纹|冲锋|牛仔|西裤/.test(positiveEvidence)) {
    return false;
  }
  if (/heattech|发热/i.test(text)) return true;
  const fullLength = /长裤|全长|长款/.test(text);
  const closeFit = /贴身|贴合|紧身|修身/.test(text);
  const fineKnit = /平针织|薄针织|细密针织|针织.*弹力|弹力.*针织|混色针织/.test(text);
  return fullLength && closeFit && fineKnit;
}

function buildThermalInnerLayerSearchDescription(kind: 'top' | 'bottom', subCategory: string): string {
  if (kind === 'top') {
    return `${subCategory}是贴身保暖内层，适合寒冷天气和冬季通勤。穿在衬衫、针织衫、卫衣或外套里面作为上装第一层，下装搭配全长外裤或半身裙，再按气温叠穿中层和外套。`;
  }
  return `${subCategory}是裤内保暖层，适合寒冷天气和冬季通勤。穿在贴身内裤外、全长外裤里面，可与牛仔裤、西裤、加绒裤或滑雪裤叠穿；外层搭配毛衣和外套，避免再叠加厚袜型腿层。`;
}

function normalizeThermalInnerLayerMetadata(tags: string[]) {
  const usefulTags = tags.filter((tag) => /保暖|内搭|贴身|发热|速干|德绒|叠穿/.test(tag));
  return {
    season: ['autumn', 'winter'],
    occasions: ['寒冷天气', '冬季通勤'],
    tags: [...new Set(['保暖', '内搭', ...usefulTags])].slice(0, 4),
  };
}

/** 纠正裤内保暖层的品类名和叠穿参考温区 */
export function sanitizeThermalInnerBottomFields(
  subCategory: string,
  description: string,
  tempMin: number | null,
  tempMax: number | null
): { subCategory: string; tempMin: number | null; tempMax: number | null } {
  if (!looksLikeThermalInnerBottomPants(subCategory, description)) {
    return { subCategory, tempMin, tempMax };
  }
  const combinedText = `${subCategory} ${description}`;
  let nextSub = subCategory;
  if (/速干/.test(combinedText)) {
    nextSub = '速干保暖裤';
  } else if (/打底|运动紧身|紧身长裤|针织长裤/.test(subCategory) && !/发热|保暖/.test(subCategory)) {
    nextSub = '薄针织保暖长裤';
  } else if (/打底/.test(subCategory)) {
    nextSub = '发热保暖裤';
  }
  return {
    subCategory: nextSub,
    ...THERMAL_BASE_LAYER,
  };
}

/**
 * 上装薄贴身发热/德绒内衣（按功能；电商模特单穿不算外穿证据）。
 * tags 参与判断：LLM 常把内衣标成「打底衫/长袖T」但 tags 仍写打底。
 */
export function looksLikeThermalInnerTop(
  subCategory: string,
  description = '',
  tags: string[] = []
): boolean {
  const text = `${subCategory} ${description} ${tags.join(' ')}`;
  if (/毛衣|卫衣|摇粒|抓绒|衬衫|外套|夹克|开衫|西装|法兰绒|牛津|加绒卫衣/.test(text)) {
    return false;
  }
  if (/秋衣|heattech|发热|德绒|保暖内衣|发热内衣|贴身保暖内衣|薄贴身保暖/i.test(text)) {
    return true;
  }
  const openHem = /下摆[^，。；]{0,10}(?:无收口|不收口|无束口)/.test(description);
  const wideRoundNeck =
    /大圆领|宽圆领|U领/i.test(text) ||
    (/圆领/.test(text) && /领口(?:略宽|稍宽|较宽|偏宽|宽松|开阔)/.test(text) && openHem);
  // 模型有时只写「圆领」。此时需同时有薄针织、无收口下摆和打底用途。
  const plainBaseLayerCut =
    /圆领/.test(text) &&
    !/(?:常规|普通|标准|小|窄)圆领|领口(?:偏窄|较窄|收紧)|口袋|纽扣|拉链|印花/.test(text) &&
    /薄[软细密]*针织|细薄针织/.test(description) &&
    openHem &&
    (/打底衫/.test(subCategory) || tags.some((tag) => /^(?:贴身)?打底$/.test(tag)));
  const underwearCut =
    /长袖/.test(text) &&
    (wideRoundNeck || plainBaseLayerCut) &&
    /(贴身|服帖|贴肤|修身|收身|贴合)/.test(text) &&
    (/(打底|薄针织|细针织|平针织|弹力针织|弹力面料|贴身针织)/.test(text));
  return underwearCut;
}

/** 纠正贴身保暖上衣的品类名和叠穿参考温区 */
export function sanitizeThermalInnerTopFields(
  subCategory: string,
  description: string,
  tags: string[],
  tempMin: number | null,
  tempMax: number | null
): { subCategory: string; tempMin: number | null; tempMax: number | null } {
  if (!looksLikeThermalInnerTop(subCategory, description, tags)) {
    return { subCategory, tempMin, tempMax };
  }
  return {
    subCategory: /秋衣|发热|保暖内衣|德绒/.test(subCategory) ? subCategory : '发热内衣',
    ...THERMAL_BASE_LAYER,
  };
}

/** 可见袜型腿层（裙/短七分外） */
function looksLikeSockStyleLegwear(subCategory: string, description = ''): boolean {
  const text = `${subCategory} ${description}`;
  if (looksLikeThermalInnerBottomPants(subCategory, description)) return false;
  if (/光腿神器|袜裤|连裤袜/.test(text)) return true;
  if (/羊羔绒.*打底|加绒.*打底|加厚.*打底|打底裤/.test(text)) return true;
  return false;
}

/**
 * 纠正腿层大类：
 * - 误标 BOTTOM 的袜型打底 → SOCKS
 * - 误标 SOCKS 的 HEATTECH/发热裤内层 → BOTTOM
 * - 可外穿运动紧身 / 裤内发热层 → BOTTOM
 */
export function coerceLegwearMainCategory(
  mainCategory: ClothingMainCategory,
  subCategory: string,
  description = ''
): ClothingMainCategory {
  const text = `${subCategory} ${description}`;
  if (/瑜伽裤|运动紧身|健身裤|跑步裤|训练裤/.test(text)) {
    return mainCategory === 'SOCKS' ? 'BOTTOM' : mainCategory === 'BOTTOM' ? 'BOTTOM' : mainCategory;
  }
  if (looksLikeThermalInnerBottomPants(subCategory, description)) {
    return 'BOTTOM';
  }
  if (mainCategory === 'BOTTOM' && looksLikeSockStyleLegwear(subCategory, description)) {
    return 'SOCKS';
  }
  return mainCategory;
}

/** 半身裙等裙装被误标 BOTTOM 时纠正为 ONE_PIECE（与连衣裙同大类，供 skirt 槽检索）。 */
export function looksLikeSkirtItem(subCategory: string, description = ''): boolean {
  const text = `${subCategory} ${description}`;
  if (!/裙/.test(text)) return false;
  // 袜类/打底腿层虽可能带「裤」字，但不算裙装
  if (/打底裤|连裤袜|光腿神器|袜裤/.test(text) && !/半身裙|连衣裙|短裙|长裙|背带裙/.test(text)) {
    return false;
  }
  return true;
}

export function coerceSkirtMainCategory(
  mainCategory: ClothingMainCategory,
  subCategory: string,
  description = ''
): ClothingMainCategory {
  if (mainCategory === 'ONE_PIECE') return mainCategory;
  if (mainCategory !== 'BOTTOM') return mainCategory;
  if (looksLikeSkirtItem(subCategory, description)) return 'ONE_PIECE';
  return mainCategory;
}

/** 迁移/匹配：BOTTOM 行是否应视为裙装（排除纯裤）。 */
export function isBottomRowSkirtCandidate(subCategory: string, description = ''): boolean {
  const text = `${subCategory} ${description}`;
  if (/牛仔裤|西裤|卫裤|运动裤|工装裤|阔腿裤|直筒裤|锥形裤|束脚|短裤/.test(text) && !/裙/.test(text)) {
    return false;
  }
  return looksLikeSkirtItem(subCategory, description);
}

function normalizeStringArray(values: unknown, lowercase = true): string[] {
  return coerceStringArray(values).map((value) => (lowercase ? value.toLowerCase() : value));
}

const SEASON_ALIASES: Record<string, string> = {
  spring: 'spring',
  summer: 'summer',
  autumn: 'autumn',
  fall: 'autumn',
  winter: 'winter',
  春: 'spring',
  春季: 'spring',
  夏: 'summer',
  夏季: 'summer',
  秋: 'autumn',
  秋季: 'autumn',
  冬: 'winter',
  冬季: 'winter',
};

const FORMALITY_ALIASES: Record<string, WardrobeFormality> = {
  lounge: 'lounge',
  居家: 'lounge',
  家居: 'lounge',
  athletic: 'athletic',
  运动训练: 'athletic',
  运动: 'athletic',
  训练: 'athletic',
  outdoor: 'outdoor',
  户外机能: 'outdoor',
  户外: 'outdoor',
  casual: 'casual',
  休闲: 'casual',
  休闲日常: 'casual',
  日常: 'casual',
  street: 'street',
  街头潮酷: 'street',
  街头: 'street',
  潮酷: 'street',
  'smart-casual': 'smart-casual',
  smartcasual: 'smart-casual',
  商务休闲: 'smart-casual',
  business: 'business',
  商务: 'business',
  formal: 'formal',
  正式: 'formal',
};

export function normalizeSeasonList(value: unknown): string[] {
  const seen = new Set<string>();
  for (const token of coerceStringArray(value)) {
    const mapped = SEASON_ALIASES[token.trim().toLowerCase()] ?? SEASON_ALIASES[token.trim()];
    if (mapped) seen.add(mapped);
  }
  return [...seen];
}

function normalizeFormality(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = value.trim().toLowerCase();
  return FORMALITY_ALIASES[token] ?? FORMALITY_ALIASES[value.trim()] ?? null;
}

function buildSearchDescriptionFallback(analysis: WardrobeAnalysisResult): string {
  const parts = [
    analysis.subCategory,
    analysis.description,
    analysis.tags?.length ? `Tags: ${analysis.tags.join(', ')}` : '',
    analysis.occasions?.length ? `Occasions: ${analysis.occasions.join(', ')}` : '',
  ].filter(Boolean);
  return parts.join('. ');
}

/** 硬校验 Part 1 分类字段；Part 2 缺失时用 fallback，不阻断入库 */
export function normalizeWardrobeAnalysis(
  raw: WardrobeAnalysisResult | Record<string, unknown>
): NormalizedWardrobeAnalysis | null {
  const rawMainCategory = normalizeMainCategory(raw.mainCategory);
  const subCategory = typeof raw.subCategory === 'string' ? raw.subCategory.trim() : '';
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  const season = normalizeSeasonList(raw.season);
  const material = normalizeStringArray(raw.material);
  const colors = normalizeStringArray(raw.colors);
  const tags = normalizeStringArray(raw.tags);

  if (!rawMainCategory || !subCategory || !description) {
    return null;
  }

  const explicitThermalTop =
    ((/发热内衣|保暖内衣/.test(subCategory) && /长袖|上衣/.test(description)) ||
      looksLikeThermalInnerTop(subCategory, description, tags)) &&
    !/裤|裙/.test(subCategory) && !/裤|裙/.test(description);
  const categoryBeforeSkirt = explicitThermalTop
    ? 'TOP'
    : coerceLegwearMainCategory(rawMainCategory, subCategory, description);
  const afterLegwear = categoryBeforeSkirt;
  const mainCategory = coerceSkirtMainCategory(afterLegwear, subCategory, description);
  const { tempMin: rawTempMin, tempMax: rawTempMax } = normalizeTempRange(raw.tempMin, raw.tempMax);
  const sanitized =
    mainCategory === 'BOTTOM'
      ? sanitizeThermalInnerBottomFields(subCategory, description, rawTempMin, rawTempMax)
      : mainCategory === 'TOP'
        ? sanitizeThermalInnerTopFields(subCategory, description, tags, rawTempMin, rawTempMax)
        : { subCategory, tempMin: rawTempMin, tempMax: rawTempMax };

  const analysis: WardrobeAnalysisResult = {
    mainCategory,
    subCategory: sanitized.subCategory,
    season,
    material,
    colors,
    tags,
    description,
    occasions: normalizeStringArray(raw.occasions),
    formality: typeof raw.formality === 'string' ? raw.formality : undefined,
    silhouette: normalizeStringArray(raw.silhouette),
    searchDescription:
      typeof raw.searchDescription === 'string' ? raw.searchDescription : undefined,
  };
  const tempMin = sanitized.tempMin;
  const tempMax = sanitized.tempMax;
  const thermalInnerTop =
    mainCategory === 'TOP' && looksLikeThermalInnerTop(subCategory, description, tags);
  const thermalInnerBottom =
    mainCategory === 'BOTTOM' && looksLikeThermalInnerBottomPants(subCategory, description);
  const isThermalInnerLayer = thermalInnerTop || thermalInnerBottom;
  const thermalMetadata = isThermalInnerLayer ? normalizeThermalInnerLayerMetadata(tags) : null;
  const searchDescription = isThermalInnerLayer
    ? buildThermalInnerLayerSearchDescription(thermalInnerTop ? 'top' : 'bottom', analysis.subCategory)
    : analysis.searchDescription?.trim() || buildSearchDescriptionFallback(analysis);

  return {
    mainCategory,
    subCategory: analysis.subCategory,
    season: thermalMetadata?.season ?? season,
    material,
    colors,
    tags: thermalMetadata?.tags ?? tags,
    description,
    occasions: thermalMetadata?.occasions ?? analysis.occasions ?? [],
    formality: normalizeFormality(analysis.formality),
    silhouette: analysis.silhouette ?? [],
    searchDescription,
    tempMin,
    tempMax,
  };
}

/** 合适穿着温度。非法值丢弃；上下限颠倒时对调。 */
export function normalizeTempBound(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < -40 || rounded > 50) return null;
  return rounded;
}

export function normalizeTempRange(
  min: unknown,
  max: unknown
): { tempMin: number | null; tempMax: number | null } {
  let tempMin = normalizeTempBound(min);
  let tempMax = normalizeTempBound(max);
  if (tempMin !== null && tempMax !== null && tempMin > tempMax) {
    [tempMin, tempMax] = [tempMax, tempMin];
  }
  return { tempMin, tempMax };
}

export function wardrobeAnalysisToEmbeddingFields(
  analysis: Omit<NormalizedWardrobeAnalysis, 'tempMin' | 'tempMax'>
) {
  return {
    mainCategory: analysis.mainCategory,
    subCategory: analysis.subCategory,
    description: analysis.description,
    searchDescription: analysis.searchDescription,
    colors: analysis.colors,
    tags: analysis.tags,
    season: analysis.season,
    material: analysis.material,
    occasions: analysis.occasions,
    formality: analysis.formality ?? undefined,
    silhouette: analysis.silhouette,
  };
}

export function clothingItemToEmbeddingFields(item: {
  mainCategory: ClothingMainCategory;
  subCategory: string;
  description: string | null;
  searchDescription?: string | null;
  colors: string[];
  tags: string[];
  season: string[];
  material: string[];
  occasions?: string[];
  formality?: string | null;
  silhouette?: string[];
}) {
  return wardrobeAnalysisToEmbeddingFields({
    mainCategory: item.mainCategory,
    subCategory: item.subCategory,
    description: item.description ?? '',
    searchDescription:
      item.searchDescription?.trim() ||
      buildSearchDescriptionFallback({
        mainCategory: 'TOP',
        subCategory: item.subCategory,
        season: item.season,
        material: item.material,
        colors: item.colors,
        tags: item.tags,
        description: item.description ?? '',
      }),
    colors: item.colors,
    tags: item.tags,
    season: item.season,
    material: item.material,
    occasions: item.occasions ?? [],
    formality: item.formality ?? null,
    silhouette: item.silhouette ?? [],
  });
}

/** Visual 向量用简化文本（不含 searchDescription 全套） */
export function buildVisualEmbeddingDocumentText(item: {
  subCategory: string;
  description: string | null;
  colors: string[];
}): string {
  const colors = item.colors.join(', ');
  return [item.subCategory, item.description ?? '', colors ? `Colors: ${colors}` : '']
    .filter(Boolean)
    .join('. ');
}
