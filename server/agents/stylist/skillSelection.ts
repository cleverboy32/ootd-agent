import type { GatekeeperIntent } from '../intent';
import { isAthleticOccasion } from '@/server/utils/ragMatchQuality';

/** 先匹配更具体的形制，再匹配风格名。只注入一个。 */
const STYLE_SKILLS: { name: string; pattern: RegExp }[] = [
  { name: 'style-guofeng', pattern: /汉服|马面裙|明制|唐制|宋制/ },
  { name: 'style-new-chinese', pattern: /新中式/ },
  { name: 'style-guofeng', pattern: /古风|国风/ },
  { name: 'style-old-money', pattern: /老钱|静奢|old\s*money/i },
  { name: 'style-cool', pattern: /潮酷|甜酷|街头|酷帅|机能风?/ },
  { name: 'style-sweet', pattern: /甜美|甜妹|少女感/ },
  { name: 'style-french', pattern: /法式/ },
  { name: 'style-korean', pattern: /韩系|韩式/ },
  { name: 'style-minimal', pattern: /极简/ },
  { name: 'style-literary', pattern: /文艺/ },
  { name: 'style-commute', pattern: /通勤|职场/ },
];

function styleSkillFromText(text: string): string | undefined {
  const hit = STYLE_SKILLS.find((entry) => entry.pattern.test(text));
  return hit?.name;
}

const SUITED_STYLE_LABELS: Record<string, string> = {
  'style-guofeng': '古风',
  'style-new-chinese': '新中式',
  'style-old-money': '老钱',
  'style-cool': '潮酷',
  'style-sweet': '甜美',
  'style-french': '法式',
  'style-korean': '韩系',
  'style-minimal': '极简',
  'style-literary': '文艺',
  'style-commute': '通勤',
};

/** 把模型自由发挥收成一个已有风格词；对不上就空着 */
export function canonicalSuitedStyle(text: string | undefined): string {
  const skill = styleSkillFromText(text ?? '');
  return skill ? (SUITED_STYLE_LABELS[skill] ?? '') : '';
}

function statedPersonalStyle(text: string | undefined): string {
  const value = text?.trim() ?? '';
  if (!value || value === '日常休闲') return '';
  return value;
}

/**
 * 风格只取一个。这轮原话优先，其次是用户自己定过的风格，最后才用照片判断的适合风格。
 * 场合词和没填时的「日常休闲」都不算。
 */
export function selectStyleSkillName(
  intent: GatekeeperIntent,
  userMessage: string,
  profile?: StylistSkillProfile
): string | undefined {
  return (
    styleSkillFromText(userMessage) ||
    styleSkillFromText(intent.style_preference ?? '') ||
    styleSkillFromText(intent.special_requests ?? '') ||
    styleSkillFromText(statedPersonalStyle(profile?.personal_style)) ||
    styleSkillFromText(profile?.suited_style ?? '')
  );
}

function wantsNewClothes(intent: GatekeeperIntent, userMessage: string): boolean {
  const text = `${userMessage}\n${intent.special_requests ?? ''}`;
  return /买|新品|入手/.test(text);
}

export type StylistSkillProfile = {
  body_shape?: string;
  height?: string;
  skin_tone?: string;
  /** 用户自己说过的风格；「日常休闲」是没填时的占位，不当成风格 */
  personal_style?: string;
  /** 照片判断出的适合风格，只在这轮没点名风格时使用 */
  suited_style?: string;
};

const BODY_SKILLS: { name: string; pattern: RegExp }[] = [
  { name: 'body-pear', pattern: /梨形|梨型/ },
  { name: 'body-apple', pattern: /苹果形|苹果型/ },
  { name: 'body-petite', pattern: /小个子|显高|娇小/ },
  { name: 'body-even', pattern: /五五分/ },
  { name: 'body-broad-shoulder', pattern: /宽肩|肩膀宽|肩偏宽/ },
];

const PETITE_HEIGHT_CM = 160;

function heightCm(height: string | undefined): number | undefined {
  const match = height?.match(/(\d{2,3})/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (value < 140 || value > 220) return undefined;
  return value;
}

/** 档案和用户原话里点名的身形。梨形与苹果形冲突时只留先出现的一个。可以和五五分、宽肩、小个子同时成立。 */
export function selectBodySkillNames(
  intent: GatekeeperIntent,
  userMessage: string,
  profile?: StylistSkillProfile
): string[] {
  const text = [profile?.body_shape, userMessage, intent.special_requests].filter(Boolean).join('\n');
  const names = BODY_SKILLS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.name);
  if (names.includes('body-pear') && names.includes('body-apple')) {
    const pearAt = text.search(/梨形|梨型/);
    const appleAt = text.search(/苹果形|苹果型/);
    const drop = pearAt <= appleAt ? 'body-apple' : 'body-pear';
    names.splice(names.indexOf(drop), 1);
  }
  const height = heightCm(profile?.height);
  if (height !== undefined && height <= PETITE_HEIGHT_CM && !names.includes('body-petite')) {
    names.push('body-petite');
  }
  return names;
}

const COLOR_UNDERTONES: { name: string; pattern: RegExp }[] = [
  { name: 'color-warm', pattern: /暖调|暖皮|暖黄皮|黄皮|暖色调/ },
  { name: 'color-cool', pattern: /冷调|冷皮|冷白皮|冷色调/ },
  { name: 'color-neutral', pattern: /中性肤|中性皮/ },
];

const COLOR_SCHEME = /撞色|同色|莫兰迪|黑白|大地色|低饱和|高饱和|显白/;

/** 肤色决定脸周冷暖，一套只留一种。用户点了配色、或档案有肤色时，再加色彩与美学。 */
export function selectColorSkillNames(
  intent: GatekeeperIntent,
  userMessage: string,
  profile?: StylistSkillProfile
): string[] {
  const text = [profile?.skin_tone, userMessage, intent.special_requests, intent.style_preference]
    .filter(Boolean)
    .join('\n');
  const undertones = COLOR_UNDERTONES.filter((entry) => entry.pattern.test(text)).map((entry) => entry.name);
  if (undertones.includes('color-warm') && undertones.includes('color-cool')) {
    const warmAt = text.search(/暖调|暖皮|暖黄皮|黄皮|暖色调/);
    const coolAt = text.search(/冷调|冷皮|冷白皮|冷色调/);
    undertones.splice(undertones.indexOf(warmAt <= coolAt ? 'color-cool' : 'color-warm'), 1);
  }
  if (undertones.includes('color-neutral') && undertones.length > 1) {
    undertones.splice(undertones.indexOf('color-neutral'), 1);
  }
  if (undertones.length === 0 && !COLOR_SCHEME.test(text)) return [];
  return ['color-aesthetics', ...undertones];
}

/** 本轮 Stylist 要注入的技能。检索 query 与出方案共用。 */
export function selectStylistSkillNames(
  intent: GatekeeperIntent,
  userMessage: string,
  profile?: StylistSkillProfile
): string[] {
  const names: string[] = [];
  if (intent.weather?.trim()) names.push('weather-dressing');
  if (isAthleticOccasion(intent, userMessage)) names.push('athletic-outfit');
  if (wantsNewClothes(intent, userMessage)) names.push('outfit-design');
  const styleSkill = selectStyleSkillName(intent, userMessage, profile);
  if (styleSkill) names.push(styleSkill);
  names.push(...selectBodySkillNames(intent, userMessage, profile));
  names.push(...selectColorSkillNames(intent, userMessage, profile));
  return names;
}

/** 出方案专用。检索 query 不注入，避免读到「只出 1 套」等方案规则。 */
export function selectStylistOutfitSkillNames(intent: GatekeeperIntent): string[] {
  switch (intent.request_type) {
    case 'purchase_pairing':
      return ['stylist-purchase-pairing'];
    case 'wardrobe_pairing':
      return ['stylist-wardrobe-pairing'];
    case 'feedback_revision':
      return ['stylist-feedback-revision'];
    default:
      return [];
  }
}
