/**
 * Coarsen a Plan search_query for wardrobe vector recall:
 * keep category + silhouette, drop specific colors / craft / fit fluff.
 * Returns the original string when already coarse (or empty after strip).
 */

const COLOR_PHRASES = [
  '灰粉色',
  '浅灰粉',
  '烟灰粉',
  '灰粉',
  '雾蓝色',
  '雾蓝',
  '藏蓝色',
  '藏蓝',
  '深灰蓝',
  '灰白色',
  '灰白',
  '米白色',
  '米白',
  '冷白色',
  '冷白',
  '深灰色',
  '深灰',
  '浅灰色',
  '浅灰',
  '黑色',
  '白色',
  '蓝色',
  '粉色',
  '灰色',
  '驼色',
  '杏色',
  '奶油色',
  '卡其',
];

/** Modifiers only — never full category nouns (短靴/大衣/半身裙). */
const DETAIL_PHRASES = [
  '羊毛混纺',
  '斜纹软呢',
  '绞花',
  '玛丽珍',
  '链条',
  '方头',
  '圆头',
  '圆领',
  '高领',
  '翻领',
  '修身',
  '微阔肩',
  '阔肩',
  '长袖',
  '短袖',
  '薄针织',
  '薄款',
  '中长款',
  '中长',
  '短款',
  '低跟',
  '细金',
];

const SILHOUETTE_KEEP = [
  '高腰',
  'A字',
  '直筒',
  '阔腿',
  '针织',
  '半身裙',
  '连衣裙',
  '大衣',
  '风衣',
  '开衫',
  '外套',
  '毛衣',
  '衬衫',
  '短靴',
  '靴子',
  '运动鞋',
  '乐福',
  '围巾',
  '粗跟',
];

function stripPhrases(input: string, phrases: string[]): string {
  let q = input;
  for (const phrase of [...phrases].sort((a, b) => b.length - a.length)) {
    q = q.split(phrase).join(' ');
  }
  return q;
}

/**
 * Broaden a wardrobe search query for recall. Idempotent when already coarse.
 */
export function broadenWardrobeQuery(raw: string): string {
  const original = raw.trim().replace(/\s+/g, ' ');
  if (!original) return original;

  let q = stripPhrases(original, COLOR_PHRASES);
  q = stripPhrases(q, DETAIL_PHRASES);
  q = q
    .replace(/[，,、/|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!q || q.length < 2) {
    const kept = SILHOUETTE_KEEP.filter((token) => original.includes(token));
    q = kept.join('');
  }

  if (!q) return original;
  if (q === original) return original;
  return q;
}
