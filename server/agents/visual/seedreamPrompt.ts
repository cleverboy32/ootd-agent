import type { StylistOutfit } from '@/server/agents/stylist';
import type { UserProfileResult } from '@/server/agents/user-profile/schema';
import type { ClothingItem } from '@prisma/client';

/** 去掉 Stylist 英文 visual 字段里容易诱导欧美杂志风的措辞。maxLen 只用于场景和姿态。 */
export function simplifyVisualText(text: string, maxLen = 160): string {
  const cleaned = text
    .replace(/\bfashion model\b/gi, '')
    .replace(/\beditorial\b/gi, '')
    .replace(/\bcinematic\b/gi, '')
    .replace(/\bgolden hour glow\b/gi, 'warm natural light')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!Number.isFinite(maxLen) || cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen);
}

/**
 * snow skirt 是滑雪服下摆的防雪裙。原样留给画图模型时，skirt 会被画成半身裙。
 */
export function disambiguateImageGarmentTerms(text: string): string {
  return text.replace(
    /\bsnow skirts?\b/gi,
    'jacket-hem powder gaiter（防雪裙，属于外套下摆，不是半身裙）'
  );
}

/** 参考图旁注：只保留索引用短标签，细节走衣橱原文段，避免 slice 截断 description */
export function shortReferenceLabel(label: string, maxLen = 36): string {
  const cleaned = label.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1)}…`;
}

/** 从 ragCache 抽出衣橱单品原文描述，供 Seedream 优先还原（不被 Stylist 概括词稀释） */
export function listWardrobeItemDescriptions(
  outfit: StylistOutfit,
  ragCache: Map<string, ClothingItem> | undefined
): string[] {
  if (!ragCache?.size) return [];
  const lines: string[] = [];
  for (const item of outfit.selected_items) {
    if (item.id === 'new_item') continue;
    const cached = ragCache.get(item.id);
    const desc = cached?.description?.trim();
    if (!desc) continue;
    lines.push(`${item.name}(${item.layer}): ${desc}`);
  }
  return lines;
}

/** 参考图第一张是人物全身照时使用的标签。衣服图不得用这个前缀。 */
export const PERSON_REFERENCE_LABEL =
  '人物参考（只取脸、发型、肤色和身体比例，禁止穿这张照片里的衣服）';

export function isPersonReferenceLabel(label: string): boolean {
  return label.trim().startsWith('人物参考');
}

/** 模特主体描述：优先 env 覆盖，其次用户已验证档案，最后默认中国面孔。有全身照时不使用这段。 */
export function buildModelSubjectDescription(
  userProfile?: UserProfileResult | null,
  options?: { hasPersonReference?: boolean }
): string {
  if (options?.hasPersonReference) return '';
  const override = process.env.IMAGE_MODEL_SUBJECT?.trim();
  if (override) return override;

  const genderWord = userProfile?.gender?.trim() === '男' ? '男性' : '女性';
  const parts = [`中国年轻${genderWord}`, '东亚面孔', '自然肤质'];
  if (!userProfile) return parts.join('，');

  const hair = userProfile.visual_features?.hair_color?.trim();
  if (hair && hair !== 'unknown') parts.push(`${hair}`);
  if (userProfile.height?.trim()) parts.push(`身高约${userProfile.height.trim()}`);
  if (userProfile.body_shape?.trim()) parts.push(`${userProfile.body_shape.trim()}身形`);
  const features = userProfile.visual_features?.detected_features?.trim();
  if (features && features !== 'none') parts.push(features);

  return parts.join('，');
}

function layerKey(layer: string): string {
  return layer.trim().toLowerCase();
}

const GARMENT_DRAW_RULES: { pattern: RegExp; rule: string }[] = [
  {
    pattern: /马面裙/,
    rule: '马面裙：前后是平的裙门，褶只在两侧；裙长到脚踝。禁止画成开衩直筒裙、西装裙、普通百褶裙或及膝短裙。',
  },
  {
    pattern: /比甲/,
    rule: '比甲：无袖对襟，衣长停在描述写的位置。禁止加帽子，禁止画成拖到脚踝的长马甲。',
  },
  {
    pattern: /璎珞/,
    rule: '璎珞：贴在领口到胸前的一组垂饰。禁止画成双层珍珠项链。',
  },
];

/**
 * 整袍扣合类（圆领袍/道袍等）。模型常先验成风衣敞穿；提示词需强调一体式闭合 + 内衬仅领缘。
 * 不含短打、褙子、比甲等开合外层。
 */
const CLOSED_ROBE_PATTERN =
  /圆领袍|道袍|飞鱼服|曳撒|直身|深衣|官袍|袍服|(?:交领|圆领).{0,8}袍/;

const SLEEVELESS_OUTER_PATTERN = /比甲|无袖|背心|马甲/;

export function isClosedRobeGarment(name: string, description = ''): boolean {
  return CLOSED_ROBE_PATTERN.test(`${name} ${description}`);
}

function isInnerLayer(layer: string): boolean {
  const key = layerKey(layer);
  return key === 'inner_top' || key === 'inner' || key.includes('inner');
}

function isSleevelessOuter(name: string, description = ''): boolean {
  return SLEEVELESS_OUTER_PATTERN.test(`${name} ${description}`);
}

/**
 * 读取搭配师给出的内搭可见性。旧数据缺字段时：有整袍则保守 collar_only，否则 open。
 */
export function resolveInnerVisibility(outfit: StylistOutfit): 'collar_only' | 'open' {
  const explicit = outfit.visual_composition.inner_visibility;
  if (explicit === 'collar_only' || explicit === 'open') return explicit;
  const hasClosedRobe = outfit.selected_items.some((item) =>
    isClosedRobeGarment(item.name, item.description ?? '')
  );
  return hasClosedRobe ? 'collar_only' : 'open';
}

/** collar_only + 确有内搭 + 确有可罩住的外层（外套/袍/上装）→ 走覆盖规则 */
export function shouldCoverInner(outfit: StylistOutfit): boolean {
  if (resolveInnerVisibility(outfit) !== 'collar_only') return false;
  if (!outfit.selected_items.some((item) => isInnerLayer(item.layer))) return false;
  return Boolean(findCoverHostItem(outfit));
}

/** 覆盖宿主：优先整袍，其次 outerwear；不再用 top/dress 冒充外层，避免误吞主上装 */
function findCoverHostItem(
  outfit: StylistOutfit
): StylistOutfit['selected_items'][number] | undefined {
  const candidates = outfit.selected_items.filter((item) => !isInnerLayer(item.layer));
  return (
    candidates.find((item) => isClosedRobeGarment(item.name, item.description ?? '')) ??
    candidates.find(
      (item) => layerKey(item.layer) === 'outerwear' || layerKey(item.layer).includes('outer')
    )
  );
}

function softenClosedRobeAppearance(text: string): string {
  return text.replace(/两侧开衩[^，。；、]*/g, '侧开衩克制不明显').replace(/\s{2,}/g, ' ').trim();
}

function closedRobeHardBans(): string[] {
  return [
    '必须前襟完整扣合闭合的一体式整袍',
    '禁止敞开、对襟裂开、风衣敞穿、从中间劈开',
  ];
}

function coveredOuterSleeveBans(): string[] {
  return [
    '外层袖口必须盖至手腕，盖住内搭袖',
    '禁止前臂露出内搭浅色袖',
  ];
}

/** 无参考图时，专用款式补一句画图模型能执行的禁令。连帽斗篷保留帽子，其余斗篷禁止加帽。 */
export function garmentDrawConstraints(outfit: StylistOutfit): string[] {
  const blob = [
    ...outfit.selected_items.map((item) => `${item.name} ${item.description ?? ''}`),
    outfit.visual_composition.outfit_details,
  ].join('\n');
  const rules = GARMENT_DRAW_RULES.filter((entry) => entry.pattern.test(blob)).map((entry) => entry.rule);
  if (/斗篷/.test(blob)) {
    rules.push(
      /连帽/.test(blob)
        ? '斗篷：保留描述里的帽子，衣长停在描述写的位置。禁止无故拖到脚踝。'
        : '斗篷：没有帽子。衣长停在描述写的位置。禁止加帽子，禁止画成连帽长披风。'
    );
  }
  if (shouldCoverInner(outfit) && CLOSED_ROBE_PATTERN.test(blob)) {
    rules.push(
      '整袍：前襟完整扣合，禁止敞开或风衣敞穿；内衬仅在领口露出一线领缘，禁止腰腹大面积外露。'
    );
  }
  return rules;
}

/**
 * 无独立参考图的单品（多为 new_item）：参考 label 里看不到其名称时视为 text-only。
 * 有图时模型会偏袒参考图，无图单品容易被盖住或省略。
 */
export function listTextOnlyItems(
  outfit: StylistOutfit,
  referenceLabels: string[]
): Array<{ name: string; layer: string; id: string; description?: string }> {
  const refBlob = referenceLabels.join(' ').toLowerCase();
  return outfit.selected_items.filter((item) => {
    const name = item.name.trim();
    if (!name) return false;
    if (item.id === 'new_item') {
      // 名称未出现在任何参考标签 → 无图新品
      return !refBlob.includes(name.toLowerCase());
    }
    // 衣橱单品通常有图；若 label 完全未提及其名，也按文字单品强化
    return referenceLabels.length > 0 && !refBlob.includes(name.toLowerCase());
  });
}

export function outfitHasAccessoryItem(
  outfit: StylistOutfit,
  ragCache?: Map<string, ClothingItem>
): boolean {
  return outfit.selected_items.some(
    (item) =>
      layerKey(item.layer) === 'accessory' ||
      layerKey(item.layer).includes('accessor') ||
      ragCache?.get(item.id)?.mainCategory?.toUpperCase() === 'ACCESSORY'
  );
}

/** 整套穿搭构图：服装为主体，配饰融入整体（参考图用于款式颜色，画面仍是全身造型） */
export const OVERALL_OUTFIT_LOOK_CONSTRAINT =
  '构图以整套穿搭为主：上装/下装/鞋履与配饰组成一套完整造型；参考图用于还原各单品的款式与颜色，最终画面必须是全身协调的街拍穿搭，配饰自然佩戴融入整体，不得做成单品特写拼贴或抢戏焦点。';

/** 有配饰时强制拉开景别，避免中近景把特写挤大 */
export const ACCESSORY_FULLBODY_FRAMING =
  '全身站立（含鞋履入画），配饰只作细节点缀，不得成为构图焦点；禁止膝上特写裁切。';

/**
 * @deprecated 保留导出兼容旧测试；新逻辑用 buildAccessoryPresentConstraints。
 * 不再写厘米/项链通例，避免诱发多余项链或被理解成画布尺寸。
 */
export const ACCESSORY_ONBODY_SCALE_CONSTRAINT =
  '配饰细小精致、贴身点缀，禁止夸张放大。';

type AccessoryKind = 'earring' | 'necklace' | 'bracelet' | 'ring' | 'hair' | 'other';

function detectAccessoryKinds(blob: string): Set<AccessoryKind> {
  const kinds = new Set<AccessoryKind>();
  if (/耳环|耳坠|耳钉|耳圈|hoop|earring|stud/i.test(blob)) kinds.add('earring');
  if (/项链|项圈|吊坠|细链|锁骨链|choker|necklace|pendant/i.test(blob)) kinds.add('necklace');
  if (/手链|手镯|bracelet/i.test(blob)) kinds.add('bracelet');
  if (/戒指|ring\b/i.test(blob)) kinds.add('ring');
  if (/发夹|发箍|hair\s*clip|headband/i.test(blob)) kinds.add('hair');
  if (kinds.size === 0 && /配饰|accessory|ACCESSORY/i.test(blob)) kinds.add('other');
  return kinds;
}

/** 汇总方案里实际出现的小首饰品类（含参考 label）。 */
export function collectAccessoryKinds(
  outfit: StylistOutfit,
  referenceLabels: string[] = []
): Set<AccessoryKind> {
  const blob = [
    ...outfit.selected_items.map((item) => `${item.name} ${item.layer} ${item.description ?? ''}`),
    outfit.visual_composition.outfit_details,
    ...referenceLabels,
  ].join('\n');
  return detectAccessoryKinds(blob);
}

/**
 * 有什么配饰写什么约束：定性（细小精致）+ 相对人体；未出现的品类写禁止添加。
 */
export function buildAccessoryPresentConstraints(
  outfit: StylistOutfit,
  referenceLabels: string[] = []
): string[] {
  if (!outfitHasAccessoryItem(outfit) && !referenceLabels.some(isAccessoryReferenceLabel)) {
    return [];
  }
  const kinds = collectAccessoryKinds(outfit, referenceLabels);
  const lines: string[] = [];
  if (kinds.has('earring')) {
    lines.push(
      '耳环极小极细、紧贴耳垂，圈径远小于耳廓，禁止偏大圆环、禁止垂到下颌或占半边脸。'
    );
  }
  if (kinds.has('necklace')) {
    lines.push('项链极细贴锁骨，坠饰豆粒大小，禁止粗链或胸口巨坠。');
  }
  if (kinds.has('bracelet')) {
    lines.push('手链/手镯细小精致，禁止夸张放大。');
  }
  if (kinds.has('ring')) {
    lines.push('戒指细小精致，禁止夸张放大。');
  }
  if (kinds.has('hair')) {
    lines.push('发饰细小精致，融入发型，禁止夸张放大。');
  }
  if (kinds.has('other') && lines.length === 0) {
    lines.push(ACCESSORY_ONBODY_SCALE_CONSTRAINT);
  }
  lines.push('禁止按产品特写占画面比例放大。');
  lines.push(ACCESSORY_FULLBODY_FRAMING);
  return lines;
}

/** 与 accessoryScaleRef 对齐：小首饰才补描写，包/帽等大配饰不改。 */
function isTextOnlySmallJewelry(name: string, layer: string): boolean {
  const blob = `${name} ${layer} accessory`;
  if (/包|帽|围巾|丝巾|腰带|发带|bag|hat|scarf|belt|tote|purse|handbag/i.test(blob)) {
    return false;
  }
  return (
    layerKey(layer) === 'accessory' ||
    /耳环|耳坠|耳钉|项链|项圈|手链|手镯|戒指|发夹|发箍|choker|earring|necklace|bracelet|pendant/i.test(
      blob
    )
  );
}

/** 无产品图的小首饰：补细小精致描写，不用厘米（模型不认真实尺度）。 */
export function smallJewelryTextOnlyAppearance(name: string, description?: string): string {
  const baseName = name.trim();
  const desc = (description ?? '').trim();
  const blob = `${baseName} ${desc}`;
  const withDesc =
    desc && !desc.startsWith(baseName) ? `${baseName}，${desc}` : desc || baseName;
  if (/细小|精致|贴耳|贴锁骨|huggie|delicate/i.test(blob)) {
    return withDesc;
  }
  if (/圆环|圈式|耳圈|hoop/i.test(blob)) {
    return `${withDesc}，细小精致贴耳，禁止偏大圆环`;
  }
  return `${withDesc}，细小精致点缀，禁止放大`;
}

/** 参考图 label 是否为配饰（layer / ACCESSORY / 常见品类词） */
export function isAccessoryReferenceLabel(label: string): boolean {
  const head = label.split(/\s*[|—]\s*/)[0] ?? label;
  const rest = label.slice(head.length);
  if (/\baccessory\b/i.test(label) || /\bACCESSORY\b/.test(label)) return true;
  if (/配饰/.test(label)) return true;
  return /耳环|耳坠|耳钉|项链|项圈|手链|手镯|戒指|发夹|发箍|choker|earring|necklace|bracelet|pendant/i.test(
    `${head} ${rest}`
  );
}

function referenceDisplayName(label: string): string {
  const head = label.split(/\s*[|—]\s*/)[0]?.trim() ?? label.trim();
  return head.replace(/\s*\([^)]*\)\s*$/, '').trim() || label.trim();
}

function oneClause(text: string, maxLen = 36): string {
  const cleaned = simplifyVisualText(text, maxLen);
  const cut = cleaned.split(/[。；;]/)[0]?.trim() ?? cleaned;
  return cut.length > maxLen ? cut.slice(0, maxLen) : cut;
}

/**
 * 有单品参考图时只留短句。版型交给照片，文字再写结构会被画成另一件衣服。
 * 官方建议中文提示词约 300 字以内。
 */
function buildShortReferencePrompt(
  outfit: StylistOutfit,
  referenceLabels: string[],
  garmentLabels: string[],
  hasPersonReference: boolean,
  subject: string
): string {
  const lines: string[] = [];
  if (hasPersonReference) {
    lines.push('图1只取脸和身材，不取这张照片里的衣服。');
  } else if (subject) {
    lines.push(`真实街拍，${subject}。`);
  } else {
    lines.push('真实街拍。');
  }

  const firstGarmentIndex = hasPersonReference ? 2 : 1;
  const clothingRefs: Array<{ fig: number; label: string }> = [];
  const accessoryRefs: Array<{ fig: number; label: string }> = [];
  garmentLabels.forEach((label, index) => {
    const fig = firstGarmentIndex + index;
    if (isAccessoryReferenceLabel(label)) {
      accessoryRefs.push({ fig, label });
    } else {
      clothingRefs.push({ fig, label });
    }
  });

  // 服装仍「原样穿上」；配饰后置，只取款式颜色，避免产品特写尺度被抄进全身图
  if (clothingRefs.length > 0) {
    const worn = clothingRefs
      .map((ref) => `图${ref.fig}${referenceDisplayName(ref.label)}`)
      .join('、');
    lines.push(`${worn}原样穿上，不改裤型、袖型、领和长短。`);
  }

  const textOnly = listTextOnlyItems(outfit, referenceLabels);
  if (textOnly.length > 0) {
    const bits = textOnly.map((item) => {
      const name = item.name.trim();
      const desc = disambiguateImageGarmentTerms(item.description?.trim() ?? '');
      if (isTextOnlySmallJewelry(name, item.layer)) {
        return smallJewelryTextOnlyAppearance(name, desc);
      }
      if (!desc || desc === name) return name;
      return desc.startsWith(name) ? desc : `${name}，${desc}`;
    });
    lines.push(`没有照片的单品：${bits.join('；')}。`);
  }

  const textOnlyOutfit: StylistOutfit = {
    ...outfit,
    selected_items: textOnly.map((item) => ({
      id: item.id,
      name: item.name,
      layer: item.layer,
      reason: '',
      description: item.description,
    })),
    visual_composition: {
      ...outfit.visual_composition,
      outfit_details: textOnly.map((item) => `${item.name} ${item.description ?? ''}`).join(' '),
    },
  };
  const drawRules = garmentDrawConstraints(textOnlyOutfit);
  if (drawRules.length > 0) lines.push(drawRules.join(''));

  const textBlob = textOnly.map((item) => `${item.name} ${item.description ?? ''}`).join(' ');
  if (/ski pants|滑雪裤|powder gaiter|防雪裙/i.test(textBlob)) {
    lines.push('下装必须是长滑雪裤，禁止画成半身裙、裙裤或及膝裙。');
  }

  if (accessoryRefs.length > 0) {
    const bits = accessoryRefs
      .map((ref) => `图${ref.fig}${referenceDisplayName(ref.label)}`)
      .join('、');
    lines.push(`${bits}只取款式颜色，细小精致点缀，禁止放大。`);
  }
  lines.push(...buildAccessoryPresentConstraints(outfit, referenceLabels));

  const scene = oneClause(outfit.visual_composition.background);
  const pose = oneClause(outfit.visual_composition.model_pose);
  if (scene) lines.push(`场景：${scene}。`);
  if (pose) lines.push(`姿态：${pose}。`);

  return lines.join('\n');
}

/**
 * 从【该件】单品描述抽出「必须/禁止」短句，不串到其他单品。
 */
export function structureHardBans(
  name: string,
  description: string,
  options?: { layer?: string; sceneContext?: string }
): string[] {
  const self = `${name} ${description}`;
  const bans: string[] = [];
  if (/方领/.test(self)) bans.push('必须方领，禁止圆领/U领/无袖');
  if (/及臀/.test(self)) bans.push('衣长必须及臀，禁止短到腰');
  if (/及踝|到脚踝|至脚踝|裙长及踝/.test(self)) {
    bans.push('裙长/裤长必须到脚踝，禁止及膝、过膝短款或小腿中以上裁短');
  }
  if (/窄袖/.test(self) && !/短袖|五分袖|七分袖|过肘/.test(self)) {
    bans.push('窄袖须长袖收口及腕，禁止短袖、扩口袖或喇叭袖');
  }
  if (/耳钉|stud\b/i.test(self)) bans.push('细小精致贴耳，禁止大圈耳环');
  if (/圆环|耳圈|hoop/i.test(self) && /耳环|耳饰|earring/i.test(self)) {
    bans.push('细小精致贴耳，禁止偏大圆环');
  }
  if (isClosedRobeGarment(name, description)) {
    bans.push(...closedRobeHardBans());
  }
  const layer = (options?.layer ?? '').toLowerCase();
  const isShoe = layer === 'shoes' || layer.includes('shoe') || /鞋|靴/.test(self);
  if (
    isShoe &&
    /软底/.test(self) &&
    /舞|绣花|古典|ballet|pointe/i.test(`${self} ${options?.sceneContext ?? ''}`)
  ) {
    bans.push('禁止芭蕾足尖鞋、绑带舞鞋');
  }
  return bans;
}

function compactItemAppearance(
  item: StylistOutfit['selected_items'][number],
  ragCache?: Map<string, ClothingItem>
): string {
  const wardrobeDesc = ragCache?.get(item.id)?.description?.trim() ?? '';
  const raw = (item.description?.trim() || wardrobeDesc || item.name).trim();
  const desc = disambiguateImageGarmentTerms(raw);
  if (isTextOnlySmallJewelry(item.name, item.layer)) {
    return smallJewelryTextOnlyAppearance(item.name, desc === item.name ? item.description : desc);
  }
  if (desc.startsWith(item.name.trim())) return desc;
  if (desc === item.name.trim()) return desc;
  // 描述已含款式细节时不再重复名字前缀
  if (desc.length >= 8) return desc;
  return `${item.name.trim()}，${desc}`;
}

/**
 * 无单品参考图的长路径：短 system + 编号硬约束，避免「整套穿着」与「无图单品」重复堆砌。
 */
function buildCompactTextOnlyPrompt(
  outfit: StylistOutfit,
  ragCache: Map<string, ClothingItem> | undefined,
  hasPersonReference: boolean,
  subject: string
): string {
  const lines: string[] = [];
  if (hasPersonReference) {
    lines.push('图1只取脸和身材，不穿照片里的衣服。自然光，全身站立（含鞋履入画），禁止膝上特写裁切。');
  } else {
    lines.push(`真实街拍，${subject || '东亚面孔'}。自然光，全身站立（含鞋履入画），禁止膝上特写裁切。`);
  }

  const sceneContext = outfit.visual_composition.outfit_details;
  const coverInner = shouldCoverInner(outfit);
  const coverHost = coverInner ? findCoverHostItem(outfit) : undefined;
  const coveredInner = coverInner
    ? outfit.selected_items.find((item) => isInnerLayer(item.layer))
    : undefined;
  const hostIsClosedRobe = Boolean(
    coverHost && isClosedRobeGarment(coverHost.name, coverHost.description ?? '')
  );
  const hostIsSleeveless = Boolean(
    coverHost && isSleevelessOuter(coverHost.name, coverHost.description ?? '')
  );

  const coverHostIndex = coverHost ? outfit.selected_items.indexOf(coverHost) : -1;

  lines.push('穿：');
  let itemIndex = 0;
  for (const [index, item] of outfit.selected_items.entries()) {
    // collar_only：内搭并入外层句，避免单独编号诱导外露
    if (coverInner && isInnerLayer(item.layer)) continue;

    let appearance = compactItemAppearance(item, ragCache);
    const bans = structureHardBans(item.name, item.description ?? '', {
      layer: item.layer,
      sceneContext,
    });

    if (coverInner && index === coverHostIndex) {
      if (hostIsClosedRobe) {
        appearance = softenClosedRobeAppearance(appearance).replace(/[。；;]+$/u, '');
        if (!/完整扣合|一体式整袍/.test(appearance)) {
          appearance = `完整扣合的一体式整袍：${appearance}`;
        }
      } else {
        appearance = appearance.replace(/[。；;]+$/u, '');
      }
      if (coveredInner) {
        const innerLabel = coveredInner.name.trim() || '交领中衣';
        appearance += `；内衬${innerLabel}仅在领口露出一线领缘，禁止腰腹、前襟、下摆处大面积外露`;
      }
      if (!hostIsSleeveless) {
        bans.push(...coveredOuterSleeveBans());
      }
    }

    itemIndex += 1;
    const suffix = bans.length > 0 ? `；${bans.join('；')}` : '';
    lines.push(`${itemIndex}. ${appearance}${suffix}`);
  }

  const drawRules = garmentDrawConstraints(outfit);
  if (drawRules.length > 0) {
    lines.push(drawRules.join(''));
  }
  if (coverInner) {
    const parts = ['禁止内搭在肚腹或下摆外露'];
    if (!hostIsSleeveless) parts.push('禁止前臂露出内搭袖');
    if (hostIsClosedRobe) {
      parts.unshift(
        '外袍前襟敞开、对襟裂开、未扣合、风衣敞穿、马甲感、外套从中间劈开'
      );
    }
    lines.push(`硬性禁止：${parts.join('；')}。`);
  }

  const garmentBlob = outfit.selected_items
    .map((item) => `${item.name} ${item.description ?? ''}`)
    .join(' ');
  if (/ski pants|滑雪裤|powder gaiter|防雪裙/i.test(`${garmentBlob} ${sceneContext}`)) {
    lines.push('下装必须是长滑雪裤，禁止画成半身裙、裙裤或及膝裙。');
  }

  const scene = oneClause(outfit.visual_composition.background, 48);
  const pose = oneClause(outfit.visual_composition.model_pose, 48);
  if (scene) {
    const balletScene = /把杆|舞蹈|芭蕾|练功/i.test(
      `${scene} ${outfit.visual_composition.background}`
    );
    lines.push(
      balletScene
        ? `场景：${scene}；不要画成芭蕾演出造型。`
        : `场景：${scene}。`
    );
  }
  if (pose) lines.push(`姿态：${pose}。`);

  lines.push(...buildAccessoryPresentConstraints(outfit));

  return lines.join('\n');
}

/**
 * Seedream 专用中文 prompt。
 * 有单品参考图时走短句（照片锁版型）；没有单品图时走紧凑编号硬约束。
 */
export function buildSeedreamImagePrompt(
  outfit: StylistOutfit,
  ragCache: Map<string, ClothingItem> | undefined,
  referenceLabels: string[],
  userProfile?: UserProfileResult | null
): string {
  const hasPersonReference = isPersonReferenceLabel(referenceLabels[0] ?? '');
  const garmentLabels = hasPersonReference ? referenceLabels.slice(1) : referenceLabels;
  const subject = buildModelSubjectDescription(userProfile, { hasPersonReference });
  if (garmentLabels.length > 0) {
    return buildShortReferencePrompt(
      outfit,
      referenceLabels,
      garmentLabels,
      hasPersonReference,
      subject
    );
  }
  return buildCompactTextOnlyPrompt(outfit, ragCache, hasPersonReference, subject);
}

/** 无服装参考图时拼进 prompt；有服装图时不拼，避免冲掉短句。 */
export const SEEDREAM_SYSTEM_INSTRUCTION = [
  '真实摄影街拍穿搭图，禁止插画/3D。',
  '图1只取脸与身材；允许自然美颜美肤，禁止换脸、整容变形、改头身比或拉长腿。',
  '有图单品跟参考图；没有参考图的单品以穿着描述为准，衣长裙长袖长必须与描述一致。',
  '配饰小尺寸点缀，禁止巨物化。',
].join('');
