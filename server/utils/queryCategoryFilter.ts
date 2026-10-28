import type { WardrobeSearchResult } from '@/server/services/wardrobeService';
import type { WardrobeSearchSlot } from '@/server/utils/ragSearchSlots';

/**
 * 中文品类族硬过滤：query 抽意图族 ↔ 单品中文文本定现实族，冲突则删除。
 * 衣橱 subCategory 已中文化，不再依赖英文词。
 */

type CategoryFamily =
  | 'shoes_dressy'
  | 'shoes_sneaker'
  | 'outer_knit'
  | 'outer_heavy'
  | 'outer_trench'
  | 'bottom_pants'
  | 'bottom_skirt';

const QUERY_FAMILY_PATTERNS: Array<{ family: CategoryFamily; pattern: RegExp }> = [
  {
    family: 'shoes_dressy',
    // (?<![麂])皮鞋：避免「麂皮鞋面」假阳性
    pattern: /单鞋|乐福|玛丽珍|(?<![麂])皮鞋|浅口|高跟鞋|细跟|芭蕾鞋|平底正式/,
  },
  {
    family: 'shoes_sneaker',
    pattern: /运动鞋|球鞋|跑鞋|篮球鞋|老爹鞋|训练鞋|徒步鞋/,
  },
  {
    family: 'outer_knit',
    pattern: /开衫|针织外套|针织开衫/,
  },
  {
    family: 'outer_heavy',
    pattern: /羽绒|棉服|派克|棉袄/,
  },
  {
    family: 'outer_trench',
    pattern: /风衣|大衣/,
  },
  {
    family: 'bottom_pants',
    pattern: /长裤|直筒裤|阔腿裤|西裤|牛仔裤|休闲裤|工装裤|(?<!半身|连衣|裙)裤/,
  },
  {
    family: 'bottom_skirt',
    pattern: /半身裙|A字裙|百褶裙|短裙|长裙|(?<!连衣)裙/,
  },
];

function itemText(item: WardrobeSearchResult): string {
  return `${item.subCategory} ${(item.tags ?? []).join(' ')} ${item.description ?? ''}`;
}

function detectQueryFamilies(query: string): Set<CategoryFamily> {
  const hit = new Set<CategoryFamily>();
  for (const { family, pattern } of QUERY_FAMILY_PATTERNS) {
    if (pattern.test(query)) hit.add(family);
  }
  return hit;
}

function itemLooksSneaker(text: string): boolean {
  return /运动鞋|徒步鞋|跑鞋|球鞋|训练鞋|老爹鞋|篮球鞋/.test(text);
}

function itemLooksDressyShoe(text: string): boolean {
  // 同 query：麂皮鞋面不算皮鞋
  return /单鞋|乐福|玛丽珍|(?<![麂])皮鞋|浅口|高跟|芭蕾鞋|平底正式/.test(text);
}

function itemLooksHeavyOuter(text: string): boolean {
  return /羽绒|棉服|派克|棉袄/.test(text);
}

function itemLooksHoodedOuter(text: string): boolean {
  return /连帽|帽衫/.test(text);
}

function itemLooksKnitOuter(text: string): boolean {
  return /开衫|针织/.test(text);
}

function itemLooksTrench(text: string): boolean {
  return /风衣|大衣/.test(text);
}

function itemLooksPants(text: string): boolean {
  return /裤/.test(text) && !/裙/.test(text);
}

function itemLooksSkirt(text: string): boolean {
  return /裙/.test(text);
}

function queryWantsPlainCardigan(query: string): boolean {
  return /开衫|针织开衫|针织外套/.test(query) && !/连帽|帽衫/.test(query);
}

/**
 * Drop wardrobe hits whose Chinese category family conflicts with the query.
 * Empty result stays empty (no fallback) so the slot can be none → new_item.
 */
export function filterResultsByQueryCategory(
  results: WardrobeSearchResult[],
  query: string,
  slot?: WardrobeSearchSlot | string
): WardrobeSearchResult[] {
  if (!query.trim() || results.length === 0) return results;

  const families = detectQueryFamilies(query);
  if (families.size === 0) return results;

  const plainCardigan = queryWantsPlainCardigan(query);

  return results.filter((item) => {
    const text = itemText(item);

    if (slot === 'shoes' || families.has('shoes_dressy') || families.has('shoes_sneaker')) {
      if (families.has('shoes_dressy') && itemLooksSneaker(text) && !itemLooksDressyShoe(text)) {
        return false;
      }
      if (families.has('shoes_sneaker') && itemLooksDressyShoe(text) && !itemLooksSneaker(text)) {
        return false;
      }
    }

    if (
      slot === 'outerwear' ||
      families.has('outer_knit') ||
      families.has('outer_heavy') ||
      families.has('outer_trench')
    ) {
      if (families.has('outer_knit') && itemLooksHeavyOuter(text)) return false;
      if (plainCardigan && itemLooksHoodedOuter(text)) return false;
      if (families.has('outer_heavy') && itemLooksKnitOuter(text) && !itemLooksHeavyOuter(text)) {
        return false;
      }
      if (
        families.has('outer_trench') &&
        !itemLooksTrench(text) &&
        (itemLooksHeavyOuter(text) || itemLooksHoodedOuter(text))
      ) {
        return false;
      }
    }

    if (slot === 'bottom' || families.has('bottom_pants') || families.has('bottom_skirt')) {
      if (families.has('bottom_pants') && itemLooksSkirt(text) && !itemLooksPants(text)) {
        return false;
      }
      if (families.has('bottom_skirt') && itemLooksPants(text) && !itemLooksSkirt(text)) {
        return false;
      }
    }

    return true;
  });
}
