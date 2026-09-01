import type { WardrobeSearchQuery, WardrobeSearchSlot } from '@/server/utils/ragSearchSlots';

/** 从 special_requests / 用户话术推断本轮 revision 要改的槽位 */
const SLOT_HINTS: Array<{ slot: WardrobeSearchSlot; patterns: RegExp[] }> = [
  {
    slot: 'accessory',
    patterns: [
      /项链|耳环|耳坠|耳钉|配饰|choker|颈链|吊坠|手链|戒指|围巾|帽子|腰带|包|bag/i,
      /necklace|earring|pendant|choker|scarf|belt|hat|accessory|jewelry|jewellery/i,
    ],
  },
  {
    slot: 'shoes',
    patterns: [/鞋|靴|sneakers?|shoes?|boots?|footwear|凉鞋|拖鞋/i],
  },
  {
    slot: 'outerwear',
    patterns: [/外套|大衣|风衣|夹克|开衫|outerwear|coat|jacket|cardigan|windbreaker|hoodie/i],
  },
  {
    slot: 'bottom',
    patterns: [/裤|裙(?!子装)|短裤|阔腿|bottom|trousers?|pants?|jeans|skirt|shorts/i],
  },
  {
    slot: 'top',
    patterns: [/上衣|内搭|T\s*恤|衬衫|背心|针织|top|t-?shirt|blouse|shirt|tee\b/i],
  },
  {
    slot: 'dress',
    patterns: [/连衣裙|连体|dress|one[\s-]?piece/i],
  },
];

/**
 * 从修改要求文本推断需要重新检索的槽位。
 * 无法推断时返回空数组（调用方应保留 LLM 规划的全部 query）。
 */
export function inferRevisionSearchSlots(specialRequests: string): WardrobeSearchSlot[] {
  const text = specialRequests.trim();
  if (!text) return [];

  const slots = new Set<WardrobeSearchSlot>();
  for (const { slot, patterns } of SLOT_HINTS) {
    if (patterns.some((re) => re.test(text))) {
      slots.add(slot);
    }
  }
  return [...slots];
}

/**
 * revision 检索安全网：若能推断出要改的槽位，则只保留这些槽位的 query。
 * 推断为空时原样返回（避免误杀复杂微调）。
 */
export function filterQueriesForRevisionSlots(
  queries: WardrobeSearchQuery[],
  specialRequests: string
): WardrobeSearchQuery[] {
  const slots = inferRevisionSearchSlots(specialRequests);
  if (slots.length === 0) return queries;

  const allowed = new Set(slots);
  const filtered = queries.filter((q) => q.slot && allowed.has(q.slot));
  return filtered.length > 0 ? filtered : queries;
}
