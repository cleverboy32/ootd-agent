import type { WardrobeSearchResult } from '@/server/services/wardrobeService';
import type { WardrobeSearchSlot } from '@/server/utils/ragSearchSlots';

/**
 * 风格一致性过滤：有 style-* 时，按 tags / 中文轮廓词去掉明显冲突单品。
 * 注意：库里「休闲」极常见，不能当冲突词，否则几乎滤空。
 */

type StyleConflictRule = {
  /** 命中 tags 或文案则排除 */
  conflict: RegExp;
  /** 仅对指定槽位额外排除的轮廓词 */
  slotConflict?: Partial<Record<WardrobeSearchSlot, RegExp>>;
};

const STYLE_CONFLICT_RULES: Record<string, StyleConflictRule> = {
  'style-sweet': {
    conflict: /运动|街头|街头风|工装|户外|athletic|sporty/,
    slotConflict: {
      outerwear: /连帽|棒球领|帽衫/,
      shoes: /徒步|球鞋|老爹鞋|篮球鞋/,
    },
  },
  'style-old-money': {
    conflict: /运动|街头|街头风|工装|卡通|甜酷|y2k|户外/,
    slotConflict: {
      shoes: /运动鞋|徒步|球鞋|老爹鞋/,
      outerwear: /连帽|棒球领|帽衫/,
    },
  },
  'style-minimal': {
    conflict: /卡通|街头|街头风|工装|华丽|甜酷|印花/,
  },
  'style-literary': {
    conflict: /运动|街头|街头风|工装|甜酷|厚底|户外/,
    slotConflict: {
      shoes: /运动鞋|徒步|球鞋|老爹鞋/,
    },
  },
  'style-history': {
    conflict: /运动|街头|街头风|工装|厚底|西装套装/,
    slotConflict: {
      shoes: /运动鞋|徒步|球鞋/,
      outerwear: /羽绒服|棉服|棒球/,
    },
  },
  'style-new-chinese': {
    conflict: /运动|街头|街头风|工装|马面裙|广袖/,
  },
  'style-korean': {
    conflict: /汉服|广袖|厚底雪地靴/,
  },
  'style-french': {
    conflict: /汉服|卫衣|厚底运动鞋|工装|户外|运动|摇粒绒/,
    slotConflict: {
      outerwear: /连帽|棒球领|帽衫|徒步/,
    },
  },
  'style-cool': {
    conflict: /汉服|珍珠多层|玛丽珍|毛呢长裙/,
  },
  'style-commute': {
    conflict: /汉服|礼服|厚底雪地靴|斗篷|运动短裤/,
  },
};

export function getActiveStyleSkillName(skillNames: string[] | undefined): string | undefined {
  return (skillNames ?? []).find((name) => name.startsWith('style-'));
}

function itemText(item: WardrobeSearchResult): string {
  return `${item.subCategory} ${(item.tags ?? []).join(' ')} ${item.description ?? ''}`;
}

/**
 * 滤掉与当前风格技能明显冲突的候选；滤空不回退。
 * 无 style-* 或未知风格时原样返回。
 */
export function filterResultsByStyleSkill(
  results: WardrobeSearchResult[],
  skillNames: string[] | undefined,
  slot?: WardrobeSearchSlot | string
): WardrobeSearchResult[] {
  const styleName = getActiveStyleSkillName(skillNames);
  if (!styleName || results.length === 0) return results;

  const rule = STYLE_CONFLICT_RULES[styleName];
  if (!rule) return results;

  const slotKey = (slot || '') as WardrobeSearchSlot;
  const slotPattern = rule.slotConflict?.[slotKey];

  return results.filter((item) => {
    const text = itemText(item);
    if (rule.conflict.test(text)) return false;
    if (slotPattern && slotPattern.test(text)) return false;
    return true;
  });
}
