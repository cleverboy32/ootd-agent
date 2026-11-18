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

export const WARDROBE_ANALYSIS_RULESET_VERSION = '2026-11-16.2';

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
  /** 合适穿着温度下限（摄氏度）。空表示不设下限 */
  tempMin?: number | null;
  /** 合适穿着温度上限（摄氏度）。空表示不设上限 */
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

export const WARDROBE_ANALYSIS_PROMPT = `你是服装识别助手。根据用户给出的衣服图片，只返回一个压缩 JSON，不要 markdown，不要解释。

自由文本全部用中文：subCategory、description、material、colors、tags、silhouette、occasions、searchDescription。
mainCategory 必须是 TOP、BOTTOM、OUTERWEAR、FOOTWEAR、ACCESSORY、SOCKS、ONE_PIECE 之一。
打底袜、连裤袜、长筒袜、丝袜、羊羔绒/加厚加绒**袜型**腿层、光腿神器等**可见腿层**归 SOCKS，不要标成 BOTTOM、ACCESSORY 或 FOOTWEAR。耳环项链包帽丝巾等才是 ACCESSORY。
SOCKS 与 BOTTOM 分界（看外观与穿法，不要臆造品类名）：丝袜/连裤袜/光腿神器/羊羔绒或加厚加绒袜型腿层（多配裙、短裤、七分裤，外露可见）→ SOCKS。牛仔裤、西裤、卫裤、阔腿裤、可独立外穿的瑜伽/运动紧身长裤 → BOTTOM。**薄平针织全长贴身保暖裤**（含 HEATTECH/发热/速干/秋裤型；扁平贴肤、可穿在外裤里面、非羊羔绒蓬松、非丝袜透肉）→ **必须 BOTTOM**，禁止标 SOCKS；subCategory 写「发热保暖裤」或「薄针织保暖长裤」等，**禁止擅自写成「打底裤/贴身打底裤」**（图上没写就别发明），温区用 -15-4，不要抄 SOCKS 的 -8-6。
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
7. occasions：1-3 个最适合的中文场合。训练件只写运动、健身、瑜伽等，禁止扩写「日常」「通勤」「约会」。保暖内层只写寒冷天气、冬季通勤等叠穿场景，不写单穿场景。日常衬衫不要硬加派对。不要将就凑满。
8. formality：上列八档之一。瑜伽裤/运动紧身短裤/速干训练衣必须是「运动训练」，禁止标成「休闲日常」。睡袍家居是「居家」。冲锋衣徒步鞋偏「户外机能」。明显街头潮酷外形可用「街头潮酷」。干净日常出门是「休闲日常」。
9. silhouette：1-3 个中文廓形，如宽松、直筒、短款。
10. searchDescription：2-4 句中文，围绕最适合的场合写完整搭配语境（和什么类型上装/下装/鞋怎么搭、什么场景穿）。禁止一句简单带过；禁止写到不适合的场合（训练件不要写「也可日常休闲」）。保暖内衣或裤内保暖层必须写明是内搭，不得推荐单穿/当外层；裤内保暖层只搭配全长外裤。不要只重复外观，也不要把内里颜色写成可检索词。
11. tempMin、tempMax：单件合适穿着的摄氏度（含边界），不是勉强能穿、也不是叠穿体感。必须落入下列细目档之一，禁止自创更宽档（如 12-22、4-15、5-15、8-26）。某一侧不封时用 null；配饰（非袜）两个都用 null。先看清短袖/长袖、短裤/长裤、短裙/长裙与面料厚度再选档；款式名不决定温度。拿不准选更热（更薄）一档。subCategory 写成带长短的中文品类名。
    上装 TOP：
    - 吊带/背心（冰丝/真丝/薄棉）：28-38
    - 短袖 T/Polo（普通纯棉约180g）：24-35
    - 重磅短袖 T（260-320g）：24-30
    - 薄款长袖衬衫（亚麻/天丝/真丝/府绸）：18-23
    - 重磅牛津纺/法兰绒衬衫：14-22
    - 薄款长袖打底（莫代尔/精纺棉/冰丝针织）：16-23（仅**外穿成立**的薄长袖：有一点衣身厚度/垂感，日常可当外层；不要把内衣摆拍判进本档）
    - 薄精纺针织/薄羊毛衫/常规卫衣（毛圈）：12-20
    - 加绒卫衣/重磅厚毛衣：5-14
    - 摇粒绒/抓绒套头衫（圆领或立领半开襟/胸前几粒按扣，前襟不能完全解开敞开）：5-14；mainCategory=TOP，subCategory 写「摇粒绒套头衫」等，禁止写「外套/夹克」
    - 薄贴身发热/德绒内衣：-15-4（仅贴身底层：第二皮肤贴肤、微修身、大圆领等方便叠穿的内衣剪裁；HEATTECH/发热/德绒同档；无品牌字样时，若长袖、宽领/大圆领/U领、修身贴身、薄弹力或平针织且没有衬衫/毛衣/卫衣结构，也按内衣剪裁识别；禁止厚绒蓬松、禁止当中层外穿；与加绒卫衣/摇粒绒中层在 5℃ 切开）。**电商/淘宝模特图几乎总是单穿摆拍，禁止据此写成「可春秋单穿」或改抄 16-23**；subCategory 写「发热内衣」或「薄贴身保暖内衣」，不要写成普通「长袖T恤」
    外套 OUTERWEAR：
    - 防晒衣/皮肤风衣：24-36
    - 薄针织开衫/无里衬薄西装/亚麻西装：18-25（开衫须前襟可完全解开敞开）
    - 常规垫肩西装/牛仔夹克（12-14oz）：13-21
    - 经典风衣：11-19
    - 皮衣/机车夹克：8-17
    - 摇粒绒/羊羔毛夹克或外套：5-14（须有满开拉链，或整排扣/按扣能把前襟完全解开成敞开式；仅半开襟套头 → TOP）
    - 轻薄羽绒/绗缝夹棉（充绒约60-100g）：4-12
    - 双面呢羊毛大衣：2-11
    - 常规中长羽绒/派克服（充绒约150-250g）：-8-5
    - 极寒加厚长款羽绒（充绒≥280g）：-25--2
    棉服看蓬松不看绗缝线；衣身鼓起有填充写成棉服/夹棉，对上 4-12 或更暖档，不要写成轻薄、轻量或薄壳。
    OUTERWEAR 与 TOP 分界：外套/夹克/开衫必须能把前襟完全敞开（满拉链或可解开到底的门襟）。套头卫衣、套头毛衣、半开襟摇粒绒/抓绒 → TOP，即使面料像外套、searchDescription 写「可当外层」。
    下装 BOTTOM（仅裤类）：
    - 短裤（非裙）：24-38
    - 常规牛仔裤/休闲西裤（10-13oz 等）：12-23
    - 精纺羊毛西裤/灯芯绒长裤：5-11（与常规裤 12-23 在 12℃ 切开；禁止自创 5-15）
    - 加绒牛仔裤/羊羔绒卫裤：-8-6（卫裤/牛仔裤等**外穿**下装）
    - 薄贴身速干/发热内搭裤、HEATTECH 保暖裤、滑雪底层裤、秋裤型保暖裤：-15-4（穿在全长外裤里面；薄平针织、微修身贴肤；禁止羊羔绒蓬松；mainCategory=BOTTOM；subCategory 写「发热保暖裤」等，禁止图上没写却写成「打底裤」）。无品牌字样时，若是全长、贴身的细密平针织弹力长裤，且没有口袋/抽绳/裤袢/侧条纹/反光等运动或外穿结构，也按薄贴身保暖内裤识别；仅「紧身/弹力」不能推断为运动裤。
    - 加厚羽绒裤/抓绒冲锋裤：-25-0
    硬折、有型、格纹不等于厚。偏薄下装 season 应含夏或春夏。下装不因外套叠穿压低 tempMin。禁止把光腿神器/连裤袜/羊羔绒袜型腿层标成 BOTTOM。禁止把任何裙装标成 BOTTOM。禁止把薄平针织全长发热/HEATTECH 保暖裤标成 SOCKS 或套用 -8-6；也禁止因「看起来像打底」就标 SOCKS。
    裙装 ONE_PIECE（半身裙与连衣裙等同大类）：
    - 迷你短裙：24-38
    - 无袖睡裙/家居睡裙/吊带连衣裙（薄棉皱褶等）：24-38（更薄真丝吊带可 28-38）；禁止套「薄长裙」或常规裙档
    - 真丝/雪纺/薄棉麻中长～长裙（有袖或可外穿薄裙）：24-33
    - 常规厚度中长连衣裙/半身裙（棉质、聚酯混纺垂坠、A字或直筒，约会日常可单穿）：12-23（禁止自创 12-25）；mainCategory=ONE_PIECE
    - 毛呢半身长裙/针织长裙：4-11（与常规裙 12-23 在 12℃ 切开；禁止自创 4-15）；mainCategory=ONE_PIECE
    家居/睡裙看袖长与面料薄度，勿因裙长标成常规或偏冷档。
    鞋 FOOTWEAR：
    - 凉鞋/拖鞋/洞洞鞋：25-38
    - 帆布鞋/透气网面运动鞋：16-34
    - 乐福/玛丽珍/浅口单鞋：14-25
    - 全皮板鞋/德训/复古跑鞋等休闲厚底：8-30
    - 切尔西/马丁/短靴：0-15
    - 过膝长靴/骑士靴：-2-12
    - 加绒短靴/雪地靴：-20-4
    袜 SOCKS（按 D 数/是否透肉；含裙下/短裤外可见腿层）：
    - 超薄隐形丝袜 5-10D：24-35
    - 常规薄款丝袜 15-30D：19-26
    - 半透微压丝袜 40-60D：15-21
    - 不透肉天鹅绒连裤袜 80-120D：12-17
    - 加厚不透肉春秋袜 150-220D：9-14
    - 羊羔绒/加厚加绒**袜型**腿层、光腿神器厚腿层：-8-6；mainCategory=SOCKS，subCategory 写「加绒袜裤」或「光腿神器」等（仅当外观确为裙下可见袜型）；禁止写卫裤/牛仔裤。薄平针织全长发热/HEATTECH/速干保暖裤见 BOTTOM（-15-4），勿标 SOCKS、勿用本档 -8-6、勿臆造「打底裤」品类名

{"mainCategory":"OUTERWEAR","subCategory":"牛仔夹克","season":["春","秋"],"material":["牛仔"],"colors":["蓝"],"tags":["休闲","通勤","叠穿"],"description":"蓝色牛仔夹克，金属扣，衣身是牛仔面料，硬质梭织。","occasions":["休闲","通勤"],"formality":"休闲日常","silhouette":["短款","直筒"],"searchDescription":"牛仔硬质夹克，适合春秋日常通勤和周末出门。可叠在针织或衬衫外，下装配直筒裤或牛仔裤，鞋选德训或短靴，整体偏干净休闲。","tempMin":13,"tempMax":21}`

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
  if (/羊羔绒|光腿神器|连裤袜|袜裤/.test(text)) return false;
  // 有发热/速干等明确信号即视为裤内层；裸「打底裤」不算（那是 SOCKS 误写出口）
  if (/heattech|速干|发热|排汗|秋裤|保暖内衣裤|滑雪底层|内搭裤|贴身保暖裤|发热保暖裤|薄针织保暖/i.test(text)) {
    return true;
  }
  // 无明确功能词时，只兜底纯平针织全长贴身裤；具体运动/外穿结构优先排除。
  const positiveEvidence = text.replace(/(?:无|没有|不带|未见)[^，。；;]{0,12}/g, '');
  if (/瑜伽|健身|跑步|训练|骑行|口袋|抽绳|裤袢|反光|侧条纹|冲锋|牛仔|西裤/.test(positiveEvidence)) {
    return false;
  }
  const fullLength = /长裤|全长|长款/.test(text);
  const closeFit = /贴身|贴合|紧身|修身/.test(text);
  const fineKnit = /平针织|薄针织|细密针织|针织.*弹力|弹力.*针织|混色针织/.test(text);
  return fullLength && closeFit && fineKnit;
}

const THERMAL_INNER_LAYER_TEMP = { tempMin: -15, tempMax: 4 } as const;

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

/** 纠正发热裤内层的品类名与温区（LLM 常写成「发热打底裤」+ SOCKS 袜档） */
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
    tempMin: THERMAL_INNER_LAYER_TEMP.tempMin,
    tempMax: THERMAL_INNER_LAYER_TEMP.tempMax,
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
  if (/heattech|发热|德绒|保暖内衣|发热内衣|贴身保暖内衣|薄贴身保暖/i.test(text)) {
    return true;
  }
  // 内衣剪裁常见：大圆领长袖 + 打底 + 贴肤措辞（勿因模特单穿判成春秋外穿 T）
  const underwearCut =
    /长袖/.test(text) &&
    /(大圆领|宽圆领|U领)/.test(text) &&
    /(贴身|服帖|贴肤|修身|收身|贴合)/.test(text) &&
    (/(打底|薄针织|细针织|平针织|弹力针织|弹力面料|贴身针织)/.test(text));
  return underwearCut;
}

/** 纠正上装发热内衣的品类名与温区 */
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
    subCategory: /发热|保暖内衣|德绒/.test(subCategory) ? subCategory : '发热内衣',
    tempMin: THERMAL_INNER_LAYER_TEMP.tempMin,
    tempMax: THERMAL_INNER_LAYER_TEMP.tempMax,
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
    !/裤|裙/.test(description);
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
  analysis: NormalizedWardrobeAnalysis
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
    tempMin: analysis.tempMin,
    tempMax: analysis.tempMax,
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
  tempMin?: number | null;
  tempMax?: number | null;
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
    tempMin: item.tempMin ?? null,
    tempMax: item.tempMax ?? null,
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
