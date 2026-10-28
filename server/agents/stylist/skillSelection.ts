import type { GatekeeperIntent } from '../intent';
import { loadSkillDescription } from '@/server/skills/loadSkill';

/** 先匹配更具体的形制，再匹配风格名。只用于档案 suited_style 归一，不再负责出方案注入。 */
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

export type StylistSkillProfile = {
  body_shape?: string;
  height?: string;
  skin_tone?: string;
  /** 用户自己说过的风格；「日常休闲」是没填时的占位，不当成风格 */
  personal_style?: string;
  /** 照片判断出的适合风格，只在这轮没点名风格时使用 */
  suited_style?: string;
};

/** Stylist 可选的搭配 skill（不含模式 skill）。 */
export const STYLIST_SELECTABLE_SKILL_NAMES = [
  'style-guofeng',
  'style-new-chinese',
  'style-old-money',
  'style-cool',
  'style-sweet',
  'style-french',
  'style-korean',
  'style-minimal',
  'style-literary',
  'style-commute',
  'weather-dressing',
  'athletic-outfit',
  'outfit-design',
  'body-pear',
  'body-apple',
  'body-petite',
  'body-even',
  'body-broad-shoulder',
  'color-aesthetics',
  'color-warm',
  'color-cool',
  'color-neutral',
] as const;

export type StylistSelectableSkillName = (typeof STYLIST_SELECTABLE_SKILL_NAMES)[number];

const SELECTABLE_SET = new Set<string>(STYLIST_SELECTABLE_SKILL_NAMES);

const STYLE_SKILL_SET = new Set<string>(
  STYLIST_SELECTABLE_SKILL_NAMES.filter((name) => name.startsWith('style-'))
);

const COLOR_UNDERTONE_SET = new Set(['color-warm', 'color-cool', 'color-neutral']);

/** 衣橱检索只注入会影响 query 品类的 skill；身形/色彩全文留给出方案。 */
const WARDROBE_SEARCH_SKILL_PREFIXES = ['style-', 'weather-', 'athletic-', 'outfit-'] as const;

export function filterSkillsForWardrobeSearch(names: string[]): string[] {
  return names.filter((name) =>
    WARDROBE_SEARCH_SKILL_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

export type StylistSkillCatalogEntry = {
  name: StylistSelectableSkillName;
  description: string;
};

/** 选 skill 目录：name + frontmatter「何时选」description。 */
export function listStylistSelectableSkills(): StylistSkillCatalogEntry[] {
  return STYLIST_SELECTABLE_SKILL_NAMES.map((name) => ({
    name,
    description: loadSkillDescription(name),
  }));
}

/**
 * 净化模型选出的 skill 名单：剔除非白名单、风格只留一个、
 * 梨/苹冲突只留先出现的、冷暖中性只留一个，有 undertone 时补 color-aesthetics。
 */
export function normalizeStylistSkillNames(raw: string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  let stylePicked = false;
  let undertonePicked = false;
  let hasPear = false;
  let hasApple = false;

  for (const item of raw) {
    const name = item.trim();
    if (!SELECTABLE_SET.has(name) || seen.has(name)) continue;

    if (STYLE_SKILL_SET.has(name)) {
      if (stylePicked) continue;
      stylePicked = true;
    }

    if (name === 'body-pear') {
      if (hasApple) continue;
      hasPear = true;
    }
    if (name === 'body-apple') {
      if (hasPear) continue;
      hasApple = true;
    }

    if (COLOR_UNDERTONE_SET.has(name)) {
      if (undertonePicked) continue;
      undertonePicked = true;
    }

    seen.add(name);
    names.push(name);
  }

  if (undertonePicked && !seen.has('color-aesthetics')) {
    const undertoneIndex = names.findIndex((name) => COLOR_UNDERTONE_SET.has(name));
    names.splice(Math.max(undertoneIndex, 0), 0, 'color-aesthetics');
  }

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
