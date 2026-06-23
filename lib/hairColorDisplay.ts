/** 将常见英文发色映射为中文（兼容历史数据） */
const ENGLISH_HAIR_TO_ZH: Record<string, string> = {
  'dark brown': '深棕色',
  brown: '棕色',
  'light brown': '浅棕色',
  black: '黑色',
  blonde: '金色',
  blond: '金色',
  'light blonde': '浅金色',
  'dark blonde': '深金色',
  red: '红棕色',
  auburn: '红褐色',
  gray: '灰色',
  grey: '灰色',
  white: '银白色',
  silver: '银灰色',
  chestnut: '栗棕色',
  burgundy: '酒红色',
  platinum: '铂金色',
  ginger: '姜黄色',
  'strawberry blonde': '草莓金',
};

export function normalizeHairColorToZh(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'unknown') return trimmed;
  return ENGLISH_HAIR_TO_ZH[trimmed.toLowerCase()] ?? trimmed;
}

export function normalizeVisualFeaturesForZh(
  visual: { hair_color: string; detected_features: string }
): { hair_color: string; detected_features: string } {
  return {
    hair_color: normalizeHairColorToZh(visual.hair_color),
    detected_features: visual.detected_features.trim(),
  };
}
