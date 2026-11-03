import type { StylistOutfit, StylistResult } from './schema';

type OutfitLike = Pick<StylistOutfit, 'selected_items'> & {
  overall_concept?: string;
};

/** 从近期方案里抽出 new_item 的 layer+name，供重做时避复用。 */
export function collectRecentNewItemLabels(
  previousOutfits?: OutfitLike[] | null,
  priorResults?: Array<Pick<StylistResult, 'outfits'>> | null
): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();

  const pushFrom = (outfits: OutfitLike[] | undefined) => {
    for (const outfit of outfits ?? []) {
      for (const item of outfit.selected_items ?? []) {
        if (item.id !== 'new_item') continue;
        const name = item.name?.trim() ?? '';
        const layer = item.layer?.trim() ?? '';
        if (!name) continue;
        const label = layer ? `${layer}: ${name}` : name;
        const key = label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        labels.push(label);
      }
    }
  };

  pushFrom(previousOutfits ?? undefined);
  for (const result of (priorResults ?? []).slice(-3)) {
    pushFrom(result.outfits);
  }
  return labels;
}

const COLOR_TOKENS = [
  '玄黑',
  '墨黑',
  '炭黑',
  '藏青',
  '靛蓝',
  '深靛',
  '墨青',
  '月白',
  '米白',
  '奶白',
  '杏色',
  '驼色',
  '浅灰',
  '深灰',
  '烟灰',
  '酒红',
  '朱红',
  '大红',
  '粉',
  '蜜桃',
  '橄榄绿',
  '墨绿',
  '檀褐',
  '深棕',
  '棕色',
  '黑',
  '白',
  '灰',
  '蓝',
  '米',
] as const;

const SILHOUETTE_TOKENS = [
  '短打',
  '长身',
  '战袍',
  '圆领袍',
  '飞鱼',
  '曳撒',
  '贴里',
  '褙子',
  '直身',
  '深衣',
  '曲裾',
  '大袖',
  '襦裙',
  '马面',
  '短款裤装',
  '长款裙装',
  '短款裙装',
  '长外套裤装',
  '短款夹克',
  '敞开长大衣',
  'H型裤装',
  '裙装',
  '无外套',
  '阔腿',
  '直筒',
  'A字',
  '风衣',
  '大衣',
  '开衫',
  '西装',
  '夹克',
  '卫衣',
  '连衣裙',
  '半身裙',
  '乐福',
  '德训',
  '皂靴',
  '马丁',
  '切尔西',
] as const;

function extractTokens(text: string, lexicon: readonly string[]): string[] {
  const hit: string[] = [];
  const lower = text.toLowerCase();
  for (const token of lexicon) {
    if (text.includes(token) || lower.includes(token.toLowerCase())) {
      hit.push(token);
    }
  }
  return hit;
}

/** 从 concept + 单品名抽出形制/色系指纹，供跨轮避复（不依赖字符串全等）。 */
export function fingerprintOutfit(outfit: OutfitLike): string {
  const parts: string[] = [];
  const concept = outfit.overall_concept?.trim() ?? '';
  const branchMatch = concept.match(/(?:形制|路径)\s*[=：:]\s*([^\s，,；;|/]+)/);
  if (branchMatch?.[1]) {
    parts.push(`branch:${branchMatch[1]}`);
  }

  const blob = [
    concept,
    ...(outfit.selected_items ?? []).map((i) => `${i.layer ?? ''} ${i.name ?? ''}`),
  ].join(' ');

  const sil = extractTokens(blob, SILHOUETTE_TOKENS);
  const col = extractTokens(blob, COLOR_TOKENS);
  if (sil.length) parts.push(`sil:${[...new Set(sil)].slice(0, 4).join('+')}`);
  if (col.length) parts.push(`col:${[...new Set(col)].slice(0, 3).join('+')}`);

  if (parts.length === 0) {
    const fallback = (outfit.selected_items ?? [])
      .filter((i) => i.id === 'new_item')
      .map((i) => i.name?.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join('|');
    return fallback || concept.slice(0, 40) || 'unknown';
  }
  return parts.join('|');
}

export function collectRecentOutfitFingerprints(
  previousOutfits?: OutfitLike[] | null,
  priorResults?: Array<Pick<StylistResult, 'outfits'>> | null
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (outfits: OutfitLike[] | undefined) => {
    for (const outfit of outfits ?? []) {
      const fp = fingerprintOutfit(outfit);
      if (!fp || seen.has(fp)) continue;
      seen.add(fp);
      out.push(fp);
    }
  };
  push(previousOutfits ?? undefined);
  for (const result of (priorResults ?? []).slice(-3)) {
    push(result.outfits);
  }
  return out;
}

/** 衣橱件跨轮冷却：近期已用过的真实衣橱 id。 */
export function collectRecentWardrobeIds(
  previousOutfits?: OutfitLike[] | null,
  priorResults?: Array<Pick<StylistResult, 'outfits'>> | null
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (outfits: OutfitLike[] | undefined) => {
    for (const outfit of outfits ?? []) {
      for (const item of outfit.selected_items ?? []) {
        const id = item.id?.trim();
        if (!id || id === 'new_item' || id.startsWith('item_')) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    }
  };
  push(previousOutfits ?? undefined);
  for (const result of (priorResults ?? []).slice(-3)) {
    push(result.outfits);
  }
  return ids;
}

function shouldEmitDiversity(requestType: string): boolean {
  return requestType === 'outfit_redo' || requestType === 'wardrobe_outfit';
}

/**
 * outfit_redo / 再次出整套：禁止同形制分支+色系指纹复读；附 new_item 字面黑名单与衣橱冷却。
 */
export function buildNewItemDiversityBlock(
  requestType: string,
  recentNewItemLabels: string[],
  options?: {
    fingerprints?: string[];
    wardrobeIds?: string[];
  }
): string {
  if (!shouldEmitDiversity(requestType)) return '';

  const fingerprints = options?.fingerprints ?? [];
  const wardrobeIds = options?.wardrobeIds ?? [];
  if (recentNewItemLabels.length === 0 && fingerprints.length === 0 && wardrobeIds.length === 0) {
    return '';
  }

  const lines: string[] = ['', '【方案多样性 — 必须遵守】'];

  if (fingerprints.length > 0) {
    lines.push(
      `- 近期方案形制/色系指纹：${fingerprints.join(' ； ')}`,
      '- 本轮【必须】换形制分支或主色块（overall_concept 写明新的「形制=」或「路径=」）；禁止同指纹微调。'
    );
  }

  if (recentNewItemLabels.length > 0) {
    lines.push(
      `- 近期 new_item：${recentNewItemLabels.join('；')}`,
      '- 若仍用 new_item：【禁止】相同颜色 + 相同品类轮廓复读；须换色或换品类轮廓。'
    );
  }

  if (wardrobeIds.length > 0) {
    lines.push(
      `- 近期已用衣橱单品 id：${wardrobeIds.join('、')}`,
      '- 本轮优先换其它衣橱候选；非用户点名锚点时，避免连续三轮选同一 id。'
    );
  }

  lines.push(
    '- 衣橱 XML 已有可接受候选时优先用衣橱，不要为了「更完美」再造同一件。',
    ''
  );
  return lines.join('\n');
}
