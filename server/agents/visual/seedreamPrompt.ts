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

  const parts = ['中国年轻女性', '东亚面孔', '自然肤质'];
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

export function isOuterwearLayer(layer: string): boolean {
  const l = layerKey(layer);
  return (
    l === 'outerwear' ||
    l.includes('outer') ||
    l.includes('jacket') ||
    l.includes('coat') ||
    l.includes('cardigan')
  );
}

export function isInnerOrTopLayer(layer: string): boolean {
  const l = layerKey(layer);
  return (
    l === 'top' ||
    l === 'inner_top' ||
    l.includes('inner') ||
    l.includes('base') ||
    l.includes('mid') ||
    l.includes('tee') ||
    l.includes('shirt')
  );
}

/** 外套 + 内搭叠穿时，现代外套需要敞开。斗篷、比甲、系带、盘扣按描述的门襟，不强制敞开。 */
const CLOSED_OUTER_PATTERN = /斗篷|比甲|系带|盘扣/;

export function outfitNeedsOpenLayering(outfit: StylistOutfit): boolean {
  const hasOuter = outfit.selected_items.some((item) => isOuterwearLayer(item.layer));
  const hasInner = outfit.selected_items.some((item) => isInnerOrTopLayer(item.layer));
  if (!hasOuter || !hasInner) return false;
  const outerText = outfit.selected_items
    .filter((item) => isOuterwearLayer(item.layer))
    .map((item) => `${item.name} ${item.description ?? ''}`)
    .join('\n');
  return !CLOSED_OUTER_PATTERN.test(outerText);
}

const GARMENT_DRAW_RULES: { pattern: RegExp; rule: string }[] = [
  {
    pattern: /马面裙/,
    rule: '马面裙：前后是平的裙门，褶只在两侧。禁止画成开衩直筒裙、西装裙或普通百褶裙。',
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

/**
 * Seedream 专用紧凑中文 prompt（官方建议中文不超过约 300 字，避免信息分散）。
 * 强调：亚洲面孔、真实街拍、反 AI 塑料感；有参考图时仍保留文字穿搭描述。
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
  const scene = simplifyVisualText(outfit.visual_composition.background);
  // 穿着描述含配饰颜色，截断会把句尾的帽子、雪镜切掉
  const outfitDesc = disambiguateImageGarmentTerms(
    simplifyVisualText(outfit.visual_composition.outfit_details, Number.POSITIVE_INFINITY)
  );
  const pose = simplifyVisualText(outfit.visual_composition.model_pose);
  const textOnly = listTextOnlyItems(outfit, referenceLabels);
  const wardrobeDescs = listWardrobeItemDescriptions(outfit, ragCache);
  const itemSummary = outfit.selected_items
    .map((i) => `${i.name}(${i.layer})`)
    .join('、');
  const garmentBlob = `${outfitDesc} ${itemSummary}`;
  const skiBottom = /ski pants|滑雪裤|powder gaiter|防雪裙/i.test(garmentBlob);

  const lines = [
    hasPersonReference
      ? '真实街拍穿搭照片。图1是用户本人，成片里的脸必须是同一个人。可以轻度整理皮肤，禁止换脸，禁止美颜成另一张脸。'
      : `真实街拍穿搭照片，${subject}。`,
    OVERALL_OUTFIT_LOOK_CONSTRAINT,
    '摄影：白天或阴天的普通自然光，人脸和衣服都清楚，像手机随手拍。禁止浅景深、大光斑、胶片颗粒、夜景路灯、强橙光、塑料皮肤和塑料面料。',
  ];

  if (hasPersonReference) {
    lines.push(
      '人物参考：五官、脸型、眼睛、鼻子、嘴唇、发型和身体比例都跟图1，只换衣服和姿势。禁止复制图1里的服装。皮肤可以均匀一点，去掉临时的痘印和硬阴影，保留毛孔和原来的冷暖肤色。禁止瘦脸、大眼、改鼻、磨成塑料皮肤、看起来年轻一截。禁止拉腿、瘦腰、缩肩、改头身比。脸要清楚，禁止虚化和换脸。'
    );
  }

  if (garmentLabels.length > 0) {
    const firstGarmentIndex = hasPersonReference ? 2 : 1;
    const refSummary = garmentLabels
      .map((label, i) => `图${firstGarmentIndex + i}${shortReferenceLabel(label)}`)
      .join('；');
    const lastGarmentIndex = firstGarmentIndex + garmentLabels.length - 1;
    lines.push(
      `单品参考（${refSummary}）：穿齐图${firstGarmentIndex}至图${lastGarmentIndex}，按参考还原款式、颜色和面料纹理。针织和毛呢保持起毛与罗纹，禁止画成光滑棉布或塑料；牛仔只保留参考图里已有的褪色，禁止自行加渐变水洗。`
    );
  }

  // 衣橱原文优先：避免 Stylist 把 front pleats 概括成 pleated 后被模型画成满裤褶皱
  if (wardrobeDescs.length > 0) {
    lines.push(
      `衣橱单品原文（结构细节以此为准，禁止夸张改写）：${wardrobeDescs.join('；')}。`
    );
  }

  // 有参考图时仍必须保留文字穿搭：无图新品/内搭只靠这段，否则易被外套盖住或省略
  if (outfitDesc) {
    lines.push(`整套穿着：${outfitDesc}。`);
  }
  if (itemSummary) {
    lines.push(`穿搭构成（须全部自然出现在同一套造型里）：${itemSummary}。`);
  }

  if (textOnly.length > 0) {
    const names = textOnly
      .map((item) => {
        const appearance = item.description?.trim();
        const label = `${item.name}(${item.layer})`;
        return appearance ? `${label}：${appearance}` : label;
      })
      .join('、');
    lines.push(
      `无参考图单品（以这句外观为准，禁止用参考图的品类或颜色替代，禁止省略或被遮挡）：${names}。`
    );
  }

  if (skiBottom) {
    lines.push('下装必须是长滑雪裤，禁止画成半身裙、裙裤或及膝裙。');
  }

  const drawRules = garmentDrawConstraints(outfit);
  if (drawRules.length > 0) {
    lines.push(`款式硬性限制：${drawRules.join('')}`);
  }

  if (outfitNeedsOpenLayering(outfit)) {
    lines.push(
      '叠穿层次：外套/夹克敞开或半敞，使内搭与外套同属一套可见造型，禁止只露外套内衬。'
    );
  }

  if (outfitHasAccessoryItem(outfit, ragCache)) {
    lines.push(
      '配饰须出现且品类正确，作为整套造型的细节点缀，与服装比例协调，不要单独放大成画面主角。'
    );
  }

  if (scene) lines.push(`场景：${scene}，日常真实环境，背景自然不喧宾夺主。`);
  lines.push('光线用均匀的白天或阴天自然光。场景文字里的路灯、夜景和暖光不要画成强橙光或大光斑。');
  if (pose) lines.push(`姿态：${pose}，放松自然，非 T 台摆拍。`);

  if (hasPersonReference) {
    lines.push('再次确认：脸是图1本人，五官和身材比例不变。皮肤只做轻度整理，不要换成另一个人。');
  }
  lines.push('全身或膝上中景，整套穿搭一眼可读，织物纹理清晰，表情自然。');

  return lines.join('\n');
}

export const SEEDREAM_SYSTEM_INSTRUCTION = [
  '生成真实摄影风格的整套穿搭展示图，不要插画、3D 或明显 AI 合成感。',
  '没有人物参考图时，模特是东亚/中国面孔，禁止生成欧美模特。有人物参考图时，脸必须是该图本人，禁止改成另一张东亚脸。可轻度整理皮肤：肤色更均匀，去掉临时痘印和硬阴影，保留毛孔和冷暖。禁止瘦脸、改五官、塑料皮肤、改变头身比和身材比例。',
  '以整套造型为主：参考图还原各单品款式颜色，配饰自然融入全身穿搭；禁止做成单品特写拼贴。',
  '有参考图的单品，款式和颜色跟参考图。面料纹理以参考图为准，文字没写到的起毛、罗纹、针织也要保留。禁止把毛呢或针织画成光滑衬衫，禁止把针织画成塑料，禁止自行添加牛仔裤渐变褪色。没有参考图的单品以穿着描述为准，禁止用参考图的品类替代它们。',
  '若参考图中有人物全身照，该图只用于脸、发型、肤色和身体比例，禁止把照片里的衣服画进成片；服装以单品参考图和穿着描述为准。',
  '现代夹克、皮衣、西装外套有内搭时敞开或半敞，露出内搭，禁止只画外套内衬。斗篷、比甲、系带和盘扣的外层按描述的门襟，不要为了露内搭改成长披风。',
].join('');
