import type { StylistOutfit } from '@/server/agents/stylist';
import type { UserProfileResult } from '@/server/agents/user-profile/schema';
import type { ClothingItem } from '@prisma/client';

/** 去掉 Stylist 英文 visual 字段里容易诱导欧美杂志风的措辞 */
export function simplifyVisualText(text: string): string {
  return text
    .replace(/\bfashion model\b/gi, '')
    .replace(/\beditorial\b/gi, '')
    .replace(/\bcinematic\b/gi, '')
    .replace(/\bgolden hour glow\b/gi, 'warm natural light')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 160);
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
  const outfitDesc = simplifyVisualText(outfit.visual_composition.outfit_details);
  const pose = simplifyVisualText(outfit.visual_composition.model_pose);
  const textOnly = listTextOnlyItems(outfit, referenceLabels);
  const itemSummary = outfit.selected_items
    .map((i) => `${i.name}(${i.layer})`)
    .join('、')
    .slice(0, 180);

  const lines = [
    `真实街拍穿搭照片，${subject}。`,
    '摄影：自然光或柔和侧光，85mm 人像镜头，浅景深，真实皮肤纹理，轻微胶片颗粒；避免过度磨皮、塑料感、CGI 渲染、欧美模特、时尚杂志硬光、夸张滤镜。',
  ];

  if (referenceLabels.length > 0) {
    const refSummary = referenceLabels
      .map((label, i) => `图${i + 1}${label.slice(0, 48)}`)
      .join('；');
    lines.push(
      `严格还原参考图单品（${refSummary}），模特穿齐图1至图${referenceLabels.length}，款式颜色与廓形一致。`
    );
  }

  // 有参考图时仍必须保留文字穿搭：无图新品/内搭只靠这段，否则易被外套盖住或省略
  if (outfitDesc) {
    lines.push(`穿着描述：${outfitDesc}。`);
  }
  if (itemSummary) {
    lines.push(`单品清单（须全部可见）：${itemSummary}。`);
  }

  if (textOnly.length > 0) {
    const names = textOnly.map((i) => `${i.name}(${i.layer})`).join('、');
    lines.push(
      `无参考图单品（按文字清晰画出，禁止省略或被遮挡）：${names}。`
    );
  }

  if (outfitNeedsOpenLayering(outfit)) {
    lines.push(
      '叠穿可见性：外套/夹克必须敞开或半敞穿着，内搭（尤其无图新品）的领口、颜色与面料须在前胸清晰可见；禁止只露出外套深色内衬，禁止把内搭画成看不见。'
    );
  }

  if (outfitHasAccessoryItem(outfit, ragCache)) {
    lines.push(
      '配饰完整且准确：方案中的每件配饰都必须出现且品类正确（项链≠耳环≠包≠帽≠围巾），禁止漏画、替换或发明未点名的配饰；项链/耳环/choker 等按真人佩戴正常比例落在耳垂或锁骨，配饰参考图多为商品特写，只还原款式与颜色，禁止按特写画面占比放大。'
    );
  }

  if (scene) lines.push(`场景：${scene}，日常真实环境，背景自然不喧宾夺主。`);
  if (pose) lines.push(`姿态：${pose}，放松自然，非 T 台摆拍。`);

  lines.push('全身或膝上中景，织物纹理清晰，表情自然。');

  return lines.join('\n');
}

export const SEEDREAM_SYSTEM_INSTRUCTION = [
  '生成真实摄影风格的穿搭展示图，不要插画、3D 或明显 AI 合成感。',
  '模特必须是东亚/中国面孔，禁止生成欧美模特。',
  '服装必须与参考图及文字描述一致，不得改变裤长、裙长、领型与配色；无参考图的单品按文字描述清晰可见。',
  '有外套+内搭时外套须敞开，露出内搭本体，禁止只画外套内衬。',
  '配饰必须全部佩戴且品类正确，禁止漏画或替换；按真人佩戴尺寸绘制，禁止把商品特写参考图的画面占比照搬放大。',
].join('');
