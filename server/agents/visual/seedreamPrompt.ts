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

/**
 * Seedream 专用紧凑中文 prompt（官方建议中文不超过约 300 字，避免信息分散）。
 * 强调：亚洲面孔、真实街拍、反 AI 塑料感。
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
  } else if (outfitDesc) {
    lines.push(`穿着：${outfitDesc}。`);
  }

  const hasAccessory = outfit.selected_items.some(
    (item) =>
      item.layer === 'accessory' ||
      ragCache?.get(item.id)?.mainCategory === 'ACCESSORY'
  );
  if (hasAccessory) {
    lines.push(
      '配饰尺寸：项链/耳环/choker/小配饰必须按真人佩戴正常比例，落在耳垂或锁骨等自然位置；配饰参考图多为商品特写，只还原款式与颜色，禁止按特写画面占比放大成夸张巨物。'
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
  '服装必须与参考图及描述一致，不得改变裤长、裙长、领型与配色。',
  '配饰必须按真人佩戴尺寸绘制，禁止把商品特写参考图的画面占比照搬放大。',
].join('');
