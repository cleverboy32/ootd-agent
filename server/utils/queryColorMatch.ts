const COLOR_TOKEN_PATTERN =
  /(?:白|黑|红|绿|蓝|灰|米|卡其|奶油|橄榄|棕|黄|粉|紫|橙)[色]?/;

const CATEGORY_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /连衣?裙/, label: '连衣裙' },
  { pattern: /半裙|短裙|A字裙/, label: '半裙' },
  { pattern: /裙/, label: '裙子' },
  { pattern: /衬衫/, label: '衬衫' },
  { pattern: /上衣|T恤|针织衫|背心/, label: '上衣' },
  { pattern: /外套|大衣|风衣|夹克/, label: '外套' },
  { pattern: /牛仔裤|阔腿裤|短裤|裤/, label: '裤子' },
  { pattern: /鞋|靴/, label: '鞋子' },
];

const QUERY_NOISE_PATTERNS = [
  /查询衣橱[内中]?是否有?/g,
  /用户想查看衣橱里的/g,
  /并进行搭配示范/g,
  /查看衣橱里的/g,
  /展示衣橱里的/g,
  /筛选出衣橱里的/g,
  /衣橱里(的)?/g,
  /并进行搭配.*/g,
  /并进行.*/g,
  /^(有没有|想看看|看看|帮我找|帮我查)\s*/g,
];

/**
 * 将 anchor_item_summary 压缩为「颜色 + 品类」检索词，避免长句污染 embedding。
 */
export function normalizeWardrobeSearchQuery(raw: string): string {
  let q = raw.trim();
  if (!q) return q;

  for (const pattern of QUERY_NOISE_PATTERNS) {
    q = q.replace(pattern, '');
  }
  q = q.replace(/\s+/g, '').trim();
  if (!q) return raw.trim();

  if (q.length <= 16 && COLOR_TOKEN_PATTERN.test(q) && /裙|裤|衫|衣|鞋|外套|靴/.test(q)) {
    return q;
  }

  const tightPatterns = [
    /((?:白|黑|红|绿|蓝|灰|米|卡其|奶油|橄榄|棕|黄|粉|紫|橙)[色]?[\u4e00-\u9fa5]{0,4}(?:连衣)?裙子?)/,
    /((?:白|黑|红|绿|蓝|灰|米|卡其|奶油|橄榄|棕|黄|粉|紫|橙)[色]?[\u4e00-\u9fa5]{0,4}(?:衬衫|上衣|T恤|外套|针织衫|背心|牛仔裤|阔腿裤|短裤|裤子|鞋子|靴子|鞋|靴))/,
  ];
  for (const pattern of tightPatterns) {
    const match = q.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  const colorMatch = q.match(COLOR_TOKEN_PATTERN);
  const category = CATEGORY_PATTERNS.find(({ pattern }) => pattern.test(q));
  if (colorMatch && category) {
    return `${colorMatch[0]}${category.label}`;
  }
  if (category) return category.label;

  return q.length > 32 ? q.slice(0, 32) : q;
}

const COLOR_FAMILY_PATTERNS: Record<string, RegExp[]> = {
  white: [/\b(white|cream|ivory|off[\s-]?white)\b/i, /白|米白|奶油/i],
  black: [/\bblack\b/i, /黑/i],
  green: [/\b(green|olive)\b/i, /绿|橄榄/i],
  blue: [/\b(blue|denim|navy)\b/i, /蓝|牛仔/i],
  red: [/\b(red|maroon|burgundy)\b/i, /红|酒红|枣红/i],
  gray: [/\b(gray|grey|heather)\b/i, /灰/i],
  yellow: [/\b(yellow|mustard)\b/i, /黄|姜黄/i],
  pink: [/\b(pink|rose)\b/i, /粉/i],
  brown: [/\b(brown|khaki|tan)\b/i, /棕|褐|卡其|大地/i],
  purple: [/\b(purple|violet)\b/i, /紫/i],
  orange: [/\borange\b/i, /橙/i],
};

export function extractQueryColorFamilies(query: string): string[] {
  const families: string[] = [];
  for (const [family, patterns] of Object.entries(COLOR_FAMILY_PATTERNS)) {
    if (patterns.some((p) => p.test(query))) {
      families.push(family);
    }
  }
  return families;
}

const ENGLISH_COLOR_WORD =
  /\b(white|black|gray|grey|beige|cream|ivory|navy|blue|red|green|brown|khaki|pink|yellow|purple|orange|charcoal|mint|sage|olive|denim|tan|maroon|burgundy)\b/gi;

/** 供 query embedding 使用的英文颜色 token（与衣橱入库 colors 字段对齐） */
export function extractQueryEmbeddingColors(query: string): string[] {
  const colors = new Set(extractQueryColorFamilies(query));
  for (const match of query.matchAll(ENGLISH_COLOR_WORD)) {
    const token = match[0].toLowerCase();
    colors.add(token === 'grey' ? 'gray' : token);
  }
  return [...colors];
}

export function itemMatchesQueryColorFamilies(
  queryFamilies: string[],
  itemColors: string[]
): boolean {
  if (queryFamilies.length === 0) return true;
  const itemText = itemColors.join(' ');
  return queryFamilies.some((family) =>
    COLOR_FAMILY_PATTERNS[family]?.some((p) => p.test(itemText))
  );
}

export function filterItemsByQueryColor<T extends { colors: string[] }>(
  query: string,
  items: T[]
): { matched: T[]; rejected: T[] } {
  const families = extractQueryColorFamilies(query);
  if (families.length === 0) {
    return { matched: items, rejected: [] };
  }
  const matched: T[] = [];
  const rejected: T[] = [];
  for (const item of items) {
    if (itemMatchesQueryColorFamilies(families, item.colors)) {
      matched.push(item);
    } else {
      rejected.push(item);
    }
  }
  return { matched, rejected };
}
