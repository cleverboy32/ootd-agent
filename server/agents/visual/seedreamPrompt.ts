import type { StylistOutfit } from '@/server/agents/stylist';
import type { UserProfileResult } from '@/server/agents/user-profile/schema';
import type { ClothingItem } from '@prisma/client';

/** 去掉 Stylist 英文 visual 字段里容易诱导欧美杂志风的措辞 */
export function simplifyVisualText(text: string, maxLen = 160): string {
  return text
    .replace(/\bfashion model\b/gi, '')
    .replace(/\beditorial\b/gi, '')
    .replace(/\bcinematic\b/gi, '')
    .replace(/\bgolden hour glow\b/gi, 'warm natural light')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLen);
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

/** 模特主体描述：优先 env 覆盖，其次用户已验证档案，最后默认中国面孔 */
export function buildModelSubjectDescription(userProfile?: UserProfileResult | null): string {
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

/** 外套 + 内搭/上装叠穿：需要强制敞开露出内搭 */
export function outfitNeedsOpenLayering(outfit: StylistOutfit): boolean {
  const layers = outfit.selected_items.map((i) => i.layer);
  return layers.some(isOuterwearLayer) && layers.some(isInnerOrTopLayer);
}

/**
 * 无独立参考图的单品（多为 new_item）：参考 label 里看不到其名称时视为 text-only。
 * 有图时模型会偏袒参考图，无图单品容易被盖住或省略。
 */
export function listTextOnlyItems(
  outfit: StylistOutfit,
  referenceLabels: string[]
): Array<{ name: string; layer: string; id: string }> {
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
  const subject = buildModelSubjectDescription(userProfile);
  const scene = simplifyVisualText(outfit.visual_composition.background);
  // outfit_details 需要更长，避免细节（front pleats / tie-front 等）被 160 字砍掉
  const outfitDesc = simplifyVisualText(outfit.visual_composition.outfit_details, 320);
  const pose = simplifyVisualText(outfit.visual_composition.model_pose);
  const textOnly = listTextOnlyItems(outfit, referenceLabels);
  const wardrobeDescs = listWardrobeItemDescriptions(outfit, ragCache);
  const itemSummary = outfit.selected_items
    .map((i) => `${i.name}(${i.layer})`)
    .join('、')
    .slice(0, 180);

  const lines = [
    `真实街拍穿搭照片，${subject}。`,
    OVERALL_OUTFIT_LOOK_CONSTRAINT,
    '摄影：自然光或柔和侧光，85mm 人像镜头，浅景深，真实皮肤纹理，轻微胶片颗粒；避免过度磨皮、塑料感、CGI 渲染、欧美模特、时尚杂志硬光、夸张滤镜。',
  ];

  if (referenceLabels.length > 0) {
    const refSummary = referenceLabels
      .map((label, i) => `图${i + 1}${shortReferenceLabel(label)}`)
      .join('；');
    lines.push(
      `单品参考（${refSummary}）：穿齐图1至图${referenceLabels.length}，按参考还原款式与颜色，并统一成一套全身穿搭呈现。`
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
    const names = textOnly.map((i) => `${i.name}(${i.layer})`).join('、');
    lines.push(
      `无参考图单品（按文字融入整套，禁止省略或被遮挡）：${names}。`
    );
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
  if (pose) lines.push(`姿态：${pose}，放松自然，非 T 台摆拍。`);

  lines.push('全身或膝上中景，整套穿搭一眼可读，织物纹理清晰，表情自然。');

  return lines.join('\n');
}

export const SEEDREAM_SYSTEM_INSTRUCTION = [
  '生成真实摄影风格的整套穿搭展示图，不要插画、3D 或明显 AI 合成感。',
  '模特必须是东亚/中国面孔，禁止生成欧美模特。',
  '以整套造型为主：参考图还原各单品款式颜色，配饰自然融入全身穿搭；禁止做成单品特写拼贴。',
  '服装必须与参考图及衣橱单品原文一致；若穿着描述与衣橱原文冲突，以衣橱原文与参考图为准。',
  '有外套+内搭时外套须敞开，露出内搭本体，禁止只画外套内衬。',
].join('');
