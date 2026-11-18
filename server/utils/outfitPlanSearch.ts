import {
  parseWardrobeSearchSlot,
  type WardrobeSearchQuery,
  type WardrobeSearchSlot,
} from '@/server/utils/ragSearchSlots';
import {
  resolveDressingFromWeather,
  type TempRange,
} from '@/server/utils/slotTempFilter';

export interface OutfitPlanSlot {
  slot: WardrobeSearchSlot;
  target: string;
  search_query: string;
  allow_new: boolean;
}

export interface OutfitPlan {
  id: string;
  overall_concept: string;
  slots: OutfitPlanSlot[];
}

export interface OutfitPlanResult {
  outfits: OutfitPlan[];
}

/** 槽温区 → query 里用的适穿短语 */
export function formatSlotTempSuitablePhrase(range: TempRange): string | null {
  if (range.min !== null && range.max !== null) {
    return `适合${range.min}到${range.max}度单穿`;
  }
  if (range.min !== null) return `适合不低于${range.min}度单穿`;
  if (range.max !== null) return `适合不超过${range.max}度单穿`;
  return null;
}

function extractTempRangeFromText(text: string): TempRange | null {
  const range = text.match(/(-?\d+)\s*(?:到|至|~|～|-|—–)\s*(-?\d+)\s*度/);
  if (!range) return null;
  const a = Number.parseInt(range[1], 10);
  const b = Number.parseInt(range[2], 10);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

function tempRangesOverlap(a: TempRange, b: TempRange): boolean {
  const a0 = a.min ?? Number.NEGATIVE_INFINITY;
  const a1 = a.max ?? Number.POSITIVE_INFINITY;
  const b0 = b.min ?? Number.NEGATIVE_INFINITY;
  const b1 = b.max ?? Number.POSITIVE_INFINITY;
  return a0 <= b1 && a1 >= b0;
}

const QUERY_TEMP_PHRASE_RE =
  /(?:适合(?:温度)?|适穿|单件适合温度|温度适合)(?:大约|约)?\s*-?\d+\s*(?:到|至|~|～|-|—–)\s*-?\d+\s*度(?:单穿)?/g;

/**
 * 将 search_query/target 中的适穿℃ 对齐到槽温区。
 * 文中区间与槽区无交叠（或只有散落「16到24度」）时改写为槽表区间。
 */
export function alignSearchQueryTempToSlotRange(
  text: string,
  range: TempRange | null | undefined
): string {
  const raw = (text || '').trim();
  if (!raw || !range || (range.min === null && range.max === null)) return raw;

  const phrase = formatSlotTempSuitablePhrase(range);
  if (!phrase) return raw;

  const mentioned = extractTempRangeFromText(raw);
  const needsAlign = !mentioned || !tempRangesOverlap(mentioned, range);

  if (!needsAlign) return raw;

  if (QUERY_TEMP_PHRASE_RE.test(raw)) {
    return raw.replace(QUERY_TEMP_PHRASE_RE, phrase);
  }

  // 兜底：文中有「A到B度」但未带「适合…」前缀
  if (/-?\d+\s*(?:到|至|~|～|-|—–)\s*-?\d+\s*度/.test(raw)) {
    return raw.replace(/-?\d+\s*(?:到|至|~|～|-|—–)\s*-?\d+\s*度(?:单穿)?/g, () => {
      if (range.min !== null && range.max !== null) return `${range.min}到${range.max}度`;
      return phrase;
    });
  }

  return `${raw.replace(/[。．]\s*$/, '')}，${phrase}。`;
}

/** 按 weather 定档后的槽温区，改写 plan 各槽 search_query / target 中的适穿℃ */
export function alignOutfitPlanTempsToSlotRanges(
  plan: OutfitPlanResult,
  weather: string
): OutfitPlanResult {
  const dressing = resolveDressingFromWeather(weather);
  if (!dressing) return plan;

  return {
    outfits: (plan.outfits ?? []).map((outfit) => ({
      ...outfit,
      slots: (outfit.slots ?? []).map((slotItem) => {
        const range = dressing.slotRange(slotItem.slot);
        if (!range) return slotItem;
        return {
          ...slotItem,
          search_query: alignSearchQueryTempToSlotRange(slotItem.search_query, range),
          target: alignSearchQueryTempToSlotRange(slotItem.target, range),
        };
      }),
    })),
  };
}

/** 无 style：Plan 只保留一套检索骨架（强制 outfit_1） */
export function clampNoStyleOutfitPlan(plan: OutfitPlanResult): OutfitPlanResult {
  const outfits = plan.outfits ?? [];
  if (outfits.length <= 1) {
    if (outfits.length === 1 && (outfits[0].id || '').trim() !== 'outfit_1') {
      return { outfits: [{ ...outfits[0], id: 'outfit_1' }] };
    }
    return plan;
  }
  const kept = outfits.find((o) => (o.id || '').trim() === 'outfit_1') ?? outfits[0];
  return { outfits: [{ ...kept, id: 'outfit_1' }] };
}

function coverageSlotTemplate(
  slot: 'bottom' | 'skirt' | 'legwear' | 'inner_bottom',
  range: TempRange | null
): OutfitPlanSlot {
  const temp = range ? formatSlotTempSuitablePhrase(range) : null;
  const tempClause = temp ? `，${temp}` : '';
  if (slot === 'bottom') {
    return {
      slot,
      target: `裤装下装（牛仔裤/西裤/休闲裤等）${temp ? `，${temp}` : ''}`,
      search_query: `女装长裤或牛仔裤，直筒或微宽松，适合日常出行与通勤叠穿${tempClause}。`,
      allow_new: true,
    };
  }
  if (slot === 'skirt') {
    return {
      slot,
      target: `裙装（半身裙或连衣裙）${temp ? `，${temp}` : ''}`,
      search_query: `女装半身裙或连衣裙，长度过膝或及小腿，适合日常出行与通勤${tempClause}。`,
      allow_new: true,
    };
  }
  if (slot === 'inner_bottom') {
    return {
      slot,
      target: `裤内薄贴身速干或发热内搭裤${temp ? `，${temp}` : ''}`,
      search_query: `薄贴身速干或发热内搭裤，修身不臃肿，穿在全长外裤里面作为保暖底层${tempClause}。`,
      allow_new: true,
    };
  }
  return {
    slot: 'legwear',
    target: `打底袜或连裤袜等腿层${temp ? `，${temp}` : ''}`,
    search_query: `打底袜或连裤袜，贴身腿层，搭配裙装保暖或修饰，面料与厚度匹配场合${tempClause}。`,
    allow_new: true,
  };
}

/**
 * 无 style 检索骨架：补齐 bottom+skirt（及天气要求的 legwear），
 * 让共享召回池能支撑裤装/裙装多套组合。不删已有槽；不引入废弃的 dress 槽名。
 */
export function expandNoStyleCoverageSlots(
  plan: OutfitPlanResult,
  weather: string
): OutfitPlanResult {
  const outfits = plan.outfits ?? [];
  if (outfits.length === 0) return plan;

  const dressing = resolveDressingFromWeather(weather);
  const outfit = outfits[0];
  const present = new Set(
    (outfit.slots ?? [])
      .map((s) => parseWardrobeSearchSlot(s.slot) ?? s.slot)
      .filter(Boolean) as string[]
  );

  const additions: OutfitPlanSlot[] = [];
  const hasLower = present.has('bottom') || present.has('skirt');
  if (hasLower) {
    if (!present.has('bottom')) {
      additions.push(coverageSlotTemplate('bottom', dressing?.slotRange('bottom') ?? null));
    }
    if (!present.has('skirt')) {
      additions.push(coverageSlotTemplate('skirt', dressing?.slotRange('skirt') ?? null));
    }
  }

  const legwearRange = dressing?.slotRange('legwear') ?? null;
  if (legwearRange && !present.has('legwear')) {
    additions.push(coverageSlotTemplate('legwear', legwearRange));
  }

  const innerBottomRange = dressing?.slotRange('inner_bottom') ?? null;
  if (innerBottomRange && !present.has('inner_bottom')) {
    additions.push(coverageSlotTemplate('inner_bottom', innerBottomRange));
  }

  if (additions.length === 0) return plan;

  return {
    outfits: [
      {
        ...outfit,
        id: (outfit.id || '').trim() || 'outfit_1',
        slots: [...(outfit.slots ?? []), ...additions],
      },
      ...outfits.slice(1),
    ],
  };
}

/** LLM plan JSON → 扁平检索列表（每套每槽一条） */
export function flattenOutfitPlanToQueries(plan: OutfitPlanResult): WardrobeSearchQuery[] {
  const out: WardrobeSearchQuery[] = [];
  for (const outfit of plan.outfits ?? []) {
    const outfitId = (outfit.id || '').trim();
    if (!outfitId) continue;
    for (const slotItem of outfit.slots ?? []) {
      const slot = parseWardrobeSearchSlot(slotItem.slot);
      const query = (slotItem.search_query || '').trim();
      if (!query) continue;
      out.push({
        outfitId,
        slot,
        query,
        target: (slotItem.target || '').trim() || undefined,
        allowNew: slotItem.allow_new !== false,
      });
    }
  }
  return out;
}

/** Do not search the closet for a slot the user explicitly plans to buy new. */
export function omitExplicitPurchaseSlotQueries(
  queries: WardrobeSearchQuery[],
  userMessage: string,
  specialRequests = ''
): WardrobeSearchQuery[] {
  const request = `${userMessage}\n${specialRequests}`;
  const explicitlyBuyingOuterwear =
    /(?:想|要|打算|准备|计划).{0,12}(?:买|入手|购入|添置|购买)|(?:买|入手|购入|添置|购买).{0,8}(?:新|两件|几件)/u.test(request) &&
    /外套|大衣|羽绒服|棉服|风衣|夹克/u.test(request);
  if (!explicitlyBuyingOuterwear) return queries;

  return queries.filter((query) => query.slot !== 'outerwear');
}

/**
 * 粗判 new 名称/描述是否相对 plan query 换了下装主品类（裤↔裙）。
 * 仅供 audit / 单测，不阻塞主链路。
 */
export function planQueryBottomCategoryConflict(
  planQuery: string,
  newItemText: string
): boolean {
  const q = planQuery;
  const t = newItemText;
  const queryPants = /裤|西裤|牛仔裤|阔腿|直筒裤|九分裤/.test(q) && !/裙/.test(q);
  const querySkirt = /裙|半裙|A字|百褶/.test(q) && !/裤/.test(q);
  const textPants = /裤|西裤|牛仔裤|阔腿|直筒裤|九分裤/.test(t) && !/裙/.test(t);
  const textSkirt = /裙|半裙|A字|百褶/.test(t);
  if (queryPants && textSkirt) return true;
  if (querySkirt && textPants) return true;
  return false;
}
