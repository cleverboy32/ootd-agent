import type { GatekeeperIntent } from '@/server/agents/intent';
import type { WardrobeSearchResult } from '@/server/services/wardrobeService';
import type { WardrobeSearchSlot } from '@/server/utils/ragSearchSlots';

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

/** 槽位最高分低于此值 → weak */
export const SLOT_WEAK_SIMILARITY_THRESHOLD = 0.72;
/** 槽位最高分达到此值且品类适配 → adequate */
export const SLOT_ADEQUATE_SIMILARITY_THRESHOLD = 0.78;

const CORE_SLOTS: WardrobeSearchSlot[] = ['top', 'bottom', 'shoes'];

const ATHLETIC_BOTTOM_BAD =
  /wrap short|denim bermuda|denim short|cargo jean|wide-leg denim|skirt|midi|maxi dress/i;
const ATHLETIC_BOTTOM_GOOD =
  /biker short|athletic short|sport short|jogger|track pant|activewear|training short/i;

const ATHLETIC_SHOES_BAD =
  /hiking|fashion sneaker|pearl|loafer|heel|flat|sandal|boot(?!.*basket)/i;
const ATHLETIC_SHOES_GOOD =
  /basketball|high-top|athletic sneaker|running shoe|training shoe|court shoe|sport sneaker/i;

const ATHLETIC_TOP_GOOD = /activewear|athletic|sport|performance|training/i;

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
    if (item.similarity >= SLOT_ADEQUATE_SIMILARITY_THRESHOLD) return true;
    return false;
  }

  return true;
}

export function assessSlotMatch(
  results: WardrobeSearchResult[],
  slot: WardrobeSearchSlot | string,
  athletic: boolean
): SlotMatchAssessment {
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
  const bestSubCategory = top.subCategory;

  if (top.similarity < SLOT_WEAK_SIMILARITY_THRESHOLD) {
    return {
      slot,
      status: 'weak',
      bestSimilarity: top.similarity,
      bestSubCategory,
      note: `最高相似度仅 ${top.similarity.toFixed(2)}，低于可用阈值`,
    };
  }

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
      appropriate.similarity < SLOT_ADEQUATE_SIMILARITY_THRESHOLD &&
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

  if (top.similarity >= SLOT_ADEQUATE_SIMILARITY_THRESHOLD) {
    return {
      slot,
      status: 'adequate',
      bestSimilarity: top.similarity,
      bestSubCategory,
      note: '有可用的衣橱单品',
    };
  }

  return {
    slot,
    status: 'weak',
    bestSimilarity: top.similarity,
    bestSubCategory,
    note: '相似度中等，请谨慎判断是否真适配场合',
  };
}

export function buildSlotMatchAssessments(
  perQueryResults: Array<{
    slot?: string;
    results: WardrobeSearchResult[];
  }>,
  intent?: GatekeeperIntent,
  userMessage?: string
): SlotMatchAssessment[] {
  const athletic = isAthleticOccasion(intent, userMessage);
  return perQueryResults.map(({ slot, results }) =>
    assessSlotMatch(results, slot ?? 'unknown', athletic)
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
