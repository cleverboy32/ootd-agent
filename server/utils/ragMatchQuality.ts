import type { GatekeeperIntent } from '@/server/agents/intent';
import type { WardrobeSearchResult } from '@/server/services/wardrobeService';
import type { WardrobeSearchSlot } from '@/server/utils/ragSearchSlots';
import { getTextSimilarityThresholds } from '@/server/services/embedding';

export type SlotMatchStatus = 'adequate' | 'weak' | 'none';

export interface SlotMatchAssessment {
  slot: WardrobeSearchSlot | string;
  status: SlotMatchStatus;
  bestSimilarity: number;
  bestSubCategory: string;
  note: string;
}

export const ATHLETIC_OCCASION_HINT =
  /篮球|打球|足球|运动|健身|跑步|瑜伽|球类|训练|athletic|basketball|workout|gym|sport/i;

const CORE_SLOTS: WardrobeSearchSlot[] = ['top', 'bottom', 'shoes'];

const ATHLETIC_BOTTOM_BAD =
  /wrap short|denim bermuda|denim short|cargo jean|wide-leg denim|skirt|midi|maxi dress|半裙|长裙|牛仔短裤|阔腿牛仔/i;
const ATHLETIC_BOTTOM_GOOD =
  /biker short|athletic short|sport short|jogger|track pant|activewear|training short|运动短裤|骑行裤|慢跑/i;

const ATHLETIC_SHOES_BAD =
  /hiking|fashion sneaker|pearl|loafer|heel|flat|sandal|boot(?!.*basket)|乐福|高跟|凉鞋/i;
const ATHLETIC_SHOES_GOOD =
  /basketball|high-top|athletic sneaker|running shoe|training shoe|court shoe|sport sneaker|运动鞋|篮球鞋|跑鞋/i;

const ATHLETIC_TOP_GOOD = /activewear|athletic|sport|performance|training|运动/i;

export function isAthleticOccasion(intent?: GatekeeperIntent, userMessage?: string): boolean {
  const text = [intent?.occasion, intent?.special_requests, userMessage].filter(Boolean).join(' ');
  return ATHLETIC_OCCASION_HINT.test(text);
}

function itemText(item: WardrobeSearchResult): string {
  return `${item.subCategory} ${(item.tags ?? []).join(' ')} ${item.description ?? ''}`;
}

export function isItemAthleticallyAppropriate(
  item: WardrobeSearchResult,
  slot: WardrobeSearchSlot | string
): boolean {
  const text = itemText(item);
  const sub = item.subCategory;

  if (slot === 'bottom') {
    if (ATHLETIC_BOTTOM_GOOD.test(text)) return true;
    if (ATHLETIC_BOTTOM_BAD.test(sub)) return false;
    // 普通 shorts 可接受，但 wrap/denim 已在 BAD 中拦截
    if (/short/i.test(sub) && !ATHLETIC_BOTTOM_BAD.test(sub)) return true;
    return false;
  }

  if (slot === 'shoes') {
    if (ATHLETIC_SHOES_GOOD.test(text)) return true;
    if (ATHLETIC_SHOES_BAD.test(text)) return false;
    // 泛运动鞋：有 sporty/athletic tag 可接受，否则偏弱
    if (/(sporty|athletic|sport)/i.test(text)) return true;
    return false;
  }

  if (slot === 'top') {
    if (ATHLETIC_TOP_GOOD.test(text)) return true;
    // 普通 T 恤在运动场景偏弱，但不直接判死
    if (item.similarity >= getTextSimilarityThresholds().slotAdequate) return true;
    return false;
  }

  return true;
}

export type AssessSlotMatchOptions = {
  /**
   * 无 style-* 粗检索：query 只到大类时相似度系统性偏低。
   * 灰区（≥ slotWeak 且 < slotAdequate）提升为 adequate，便于衣橱组搭。
   */
  promoteGrayWhenCoarse?: boolean;
};

export function assessSlotMatch(
  results: WardrobeSearchResult[],
  slot: WardrobeSearchSlot | string,
  athletic: boolean,
  options: AssessSlotMatchOptions = {}
): SlotMatchAssessment {
  const thresholds = getTextSimilarityThresholds();

  if (results.length === 0) {
    return {
      slot,
      status: 'none',
      bestSimilarity: 0,
      bestSubCategory: '',
      note: '衣橱该槽位无召回单品',
    };
  }

  const sorted = [...results].sort((a, b) => b.similarity - a.similarity);
  const top = sorted[0];
  const second = sorted[1];
  const bestSubCategory = top.subCategory;
  const gap = second ? top.similarity - second.similarity : 1;

  // 运动场合品类硬过滤（保留原有逻辑）
  if (athletic && CORE_SLOTS.includes(slot as WardrobeSearchSlot)) {
    const appropriate = sorted.find((item) => isItemAthleticallyAppropriate(item, slot));
    if (!appropriate) {
      return {
        slot,
        status: 'weak',
        bestSimilarity: top.similarity,
        bestSubCategory,
        note: '召回单品品类/风格不适配运动场合（如时装短裤、徒步鞋）',
      };
    }
    if (
      appropriate.similarity < thresholds.slotAdequate &&
      !ATHLETIC_BOTTOM_GOOD.test(itemText(appropriate)) &&
      !ATHLETIC_SHOES_GOOD.test(itemText(appropriate)) &&
      !ATHLETIC_TOP_GOOD.test(itemText(appropriate))
    ) {
      return {
        slot,
        status: 'weak',
        bestSimilarity: appropriate.similarity,
        bestSubCategory: appropriate.subCategory,
        note: '仅有弱相关休闲单品，无真正运动装备',
      };
    }
  }

  if (top.similarity < thresholds.slotWeak) {
    return {
      slot,
      status: 'weak',
      bestSimilarity: top.similarity,
      bestSubCategory,
      note: `最高相似度仅 ${top.similarity.toFixed(2)}，低于可用阈值`,
    };
  }

  if (top.similarity >= thresholds.slotAdequate) {
    return {
      slot,
      status: 'adequate',
      bestSimilarity: top.similarity,
      bestSubCategory,
      note: '有可用的衣橱单品',
    };
  }

  // 无风格粗检索：灰区大类命中视为可用（否则粗 query 会系统性逼成整槽 new）
  if (options.promoteGrayWhenCoarse) {
    return {
      slot,
      status: 'adequate',
      bestSimilarity: top.similarity,
      bestSubCategory,
      note: `粗检索灰区相似度 ${top.similarity.toFixed(2)}：无风格时按大类命中视为可用`,
    };
  }

  // 灰区（weak～adequate 之间）一律 weak：避免「分数凑合」被当成可硬选
  return {
    slot,
    status: 'weak',
    bestSimilarity: top.similarity,
    bestSubCategory,
    note:
      gap >= thresholds.slotConfidenceGap
        ? `相似度 ${top.similarity.toFixed(2)} 灰区（与第二名差 ${gap.toFixed(2)}），未达可用阈值，建议补新品或换候选`
        : `相似度 ${top.similarity.toFixed(2)} 灰区且多件接近，未达可用阈值，建议补新品`,
  };
}

export function buildSlotMatchAssessments(
  perQueryResults: Array<{
    slot?: string;
    results: WardrobeSearchResult[];
  }>,
  intent?: GatekeeperIntent,
  userMessage?: string,
  options: AssessSlotMatchOptions = {}
): SlotMatchAssessment[] {
  const athletic = isAthleticOccasion(intent, userMessage);
  return perQueryResults.map(({ slot, results }) =>
    assessSlotMatch(results, slot ?? 'unknown', athletic, options)
  );
}

export function formatSlotMatchSummaryXml(
  assessments: SlotMatchAssessment[],
  athletic: boolean
): string {
  if (assessments.length === 0) return '';

  const lines = assessments.map((a) => {
    const attrs = [
      `slot="${a.slot}"`,
      `status="${a.status}"`,
      `bestSimilarity="${a.bestSimilarity.toFixed(2)}"`,
      `bestSubCategory="${escapeXml(a.bestSubCategory)}"`,
      `note="${escapeXml(a.note)}"`,
    ].join(' ');
    return `  <slot_assessment ${attrs}/>`;
  });

  return `\n<wardrobe_match_summary athletic="${athletic ? 'true' : 'false'}">\n${lines.join('\n')}\n</wardrobe_match_summary>\n`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/** 运动场景：从召回列表中剔除明显不适配的时装类单品，避免 Stylist 误选 */
export function filterResultsForAthleticContext(
  results: WardrobeSearchResult[],
  slot: WardrobeSearchSlot | string | undefined,
  athletic: boolean
): WardrobeSearchResult[] {
  if (!athletic || !slot) return results;
  if (!CORE_SLOTS.includes(slot as WardrobeSearchSlot)) return results;

  const filtered = results.filter((item) => isItemAthleticallyAppropriate(item, slot));
  return filtered.length > 0 ? filtered : results;
}
