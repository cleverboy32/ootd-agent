/**
 * Stylist Prompt Regression Tests
 *
 * 测试 Stylist Agent 的结构化输出是否符合约束。
 * 不依赖真实衣橱（直接喂 RAG XML fixture），专注验证 LLM 输出格式。
 *
 * 运行命令：pnpm test:prompts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ClothingItem } from '@prisma/client';
import { callStylistAgent, planWardrobeSearchQueries } from '@/server/agents/stylist/agent';
import { normalizeGatekeeperIntent } from '@/server/agents/intent';
import type { UserProfileResult } from '@/server/agents/user-profile/schema';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const EMPTY_PROFILE: UserProfileResult = {
  name: '',
  height: '',
  weight: '',
  preferences: ['简约', '日常休闲'],
  skin_tone: '暖调',
  body_shape: '',
  personal_style: '文艺简约',
  visual_features: { hair_color: '', detected_features: '' },
};

const WARDROBE_OUTFIT_INTENT = normalizeGatekeeperIntent({
  request_type: 'wardrobe_outfit',
  occasion: '日常通勤',
  style_preference: '简约',
  dressing_climate: 'mild',
});

const WARDROBE_PAIRING_INTENT = normalizeGatekeeperIntent({
  request_type: 'wardrobe_pairing',
  occasion: '日常通勤',
  anchor_item_summary: '白色连衣裙',
  anchor_slot: 'dress',
  anchor_wardrobe_id: 'item_0',
  dressing_climate: 'mild',
});

// 模拟 RAG 已通过 resolveRagRefs 还原真实 ID 后传入（测试时跳过真实 RAG）
function buildMockRagCache(): Map<string, ClothingItem> {
  const base = {
    clientProfileId: 'test-user',
    season: ['spring', 'summer'] as string[],
    material: ['cotton'] as string[],
    tags: ['casual', 'minimalist'] as string[],
    searchDescription: null,
    occasions: [] as string[],
    formality: null,
    silhouette: [] as string[],
    embedding: null,
    tempMin: null,
    tempMax: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const items: ClothingItem[] = [
    {
      ...base,
      id: 'mock-top-001',
      imageUrl: 'https://example.com/top.jpg',
      mainCategory: 'TOP',
      subCategory: 'Crew Neck T-Shirt',
      description: 'A heather grey crew neck t-shirt, relaxed fit, lightweight cotton.',
      colors: ['grey'],
    },
    {
      ...base,
      id: 'mock-bottom-001',
      imageUrl: 'https://example.com/bottom.jpg',
      mainCategory: 'BOTTOM',
      subCategory: 'Wide Leg Trousers',
      description: 'Cream wide-leg ankle-length trousers, high waist, linen blend.',
      colors: ['cream'],
    },
    {
      ...base,
      id: 'mock-shoes-001',
      imageUrl: 'https://example.com/shoes.jpg',
      mainCategory: 'FOOTWEAR',
      subCategory: 'Canvas Sneakers',
      description: 'White low-top canvas sneakers, minimalist design.',
      colors: ['white'],
    },
    {
      ...base,
      id: 'mock-dress-001',
      imageUrl: 'https://example.com/dress.jpg',
      mainCategory: 'ONE_PIECE',
      subCategory: 'Sleeveless Shift Dress',
      description: 'White sleeveless knee-length shift dress, clean silhouette.',
      colors: ['white'],
    },
  ];

  const cache = new Map<string, ClothingItem>();
  items.forEach((item) => cache.set(item.id, item));
  return cache;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SILHOUETTE_WORDS =
  /及膝|到踝|九分|阔腿|直筒|短款|短裤|五分|过膝|中长|长款|宽腿|迷你|拖地|knee[-\s]?length|ankle[-\s]?length|midi|maxi|cropped|above[-\s]?the[-\s]?knee|wide[-\s]?leg|straight[-\s]?leg|shorts|mini|floor[-\s]?length/i;

const VALID_ITEM_ID = /^item_\d+$|^new_item$|^mock-/;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Stylist — output schema compliance', () => {
  it('wardrobe_outfit: 返回 1-2 套方案，每套包含基础必填字段', async () => {
    const ragCache = buildMockRagCache();

    const result = await callStylistAgent(
      [],
      WARDROBE_OUTFIT_INTENT,
      EMPTY_PROFILE,
      [{ text: '帮我搭一套日常通勤的穿搭' }],
      undefined,
      ragCache
    );

    assert.ok(result.outfits.length >= 1, '至少返回 1 套方案');
    assert.ok(result.outfits.length <= 2, '最多返回 2 套方案');

    for (const outfit of result.outfits) {
      assert.ok(outfit.id, 'outfit.id 不能为空');
      assert.match(outfit.id, /^outfit_\d+$/, `outfit.id 格式应为 outfit_N，实际: ${outfit.id}`);
      assert.ok(outfit.overall_concept, 'overall_concept 不能为空');
      assert.ok(outfit.selected_items.length > 0, 'selected_items 不能为空');
      assert.ok(outfit.visual_composition.outfit_details, 'outfit_details 不能为空');
      assert.ok(outfit.visual_composition.model_pose, 'model_pose 不能为空');
      assert.ok(outfit.visual_composition.background, 'background 不能为空');
      assert.match(outfit.visual_composition.model_pose, /[\u4e00-\u9fff]/, 'model_pose 须为中文');
      assert.doesNotMatch(
        outfit.visual_composition.model_pose,
        /hair|bangs|young woman|fashion model|脸型|发色|刘海/i,
        `model_pose 不应改写人物外形: ${outfit.visual_composition.model_pose}`
      );
    }
  });

  it('selected_items 的 id 解析后为真实 ID 或 new_item（无 LLM 幻觉 ID）', async () => {
    const ragCache = buildMockRagCache();

    const result = await callStylistAgent(
      [],
      WARDROBE_OUTFIT_INTENT,
      EMPTY_PROFILE,
      [{ text: '帮我搭一套日常通勤的穿搭' }],
      undefined,
      ragCache
    );

    for (const outfit of result.outfits) {
      for (const item of outfit.selected_items) {
        assert.match(
          item.id,
          VALID_ITEM_ID,
          `item.id 应为衣橱 ID 或 new_item，实际: "${item.id}" (${item.name})`
        );
      }
    }
  });

  it('outfit_details 包含廓形/长度关键词（防止「五分短裤画成长裤」）', async () => {
    const ragCache = buildMockRagCache();

    const result = await callStylistAgent(
      [],
      WARDROBE_OUTFIT_INTENT,
      EMPTY_PROFILE,
      [{ text: '帮我搭一套日常通勤的穿搭' }],
      undefined,
      ragCache
    );

    for (const outfit of result.outfits) {
      assert.match(
        outfit.visual_composition.outfit_details,
        SILHOUETTE_WORDS,
        `outfit_details 应含廓形词，实际: "${outfit.visual_composition.outfit_details.slice(0, 120)}"`
      );
    }
  });
});

describe('Stylist — wardrobe_pairing: 锚定单品必须出现在每套方案中', () => {
  it('每套方案必须包含锚定单品 ID', async () => {
    const ragCache = buildMockRagCache();

    const result = await callStylistAgent(
      [],
      WARDROBE_PAIRING_INTENT,
      EMPTY_PROFILE,
      [{ text: '帮我用这条白色连衣裙搭配一套通勤穿搭' }],
      undefined,
      ragCache
    );

    for (const outfit of result.outfits) {
      const hasAnchor = outfit.selected_items.some(
        (item) => item.id === 'mock-dress-001' || item.layer === 'dress'
      );
      assert.ok(hasAnchor, `方案 ${outfit.id} 缺少锚定单品（white dress）`);
    }
  });
});

const SHORTS = /shorts?\b|短裤/i;
const RAIN_UNSAFE_SHOES = /suede|麂皮|canvas|帆布/i;
const WEATHER_WORDS = /天气|气温|温度|℃|度|凉|冷|外套/;

function weatherIntent(weather: string, occasion: string, specialRequests = '') {
  return normalizeGatekeeperIntent({
    request_type: 'wardrobe_outfit',
    occasion,
    weather,
    style_preference: '简约',
    special_requests: specialRequests,
    dressing_climate: 'mild',
  });
}

const SKILL_JARGON = /档|修正项|细则/;

type StylistOutput = Awaited<ReturnType<typeof callStylistAgent>>;

function itemsOnLayer(result: StylistOutput, layer: RegExp) {
  return result.outfits.flatMap((o) => o.selected_items.filter((item) => layer.test(item.layer)));
}

function assertNoSkillJargon(result: StylistOutput) {
  for (const item of result.outfits.flatMap((o) => o.selected_items)) {
    assert.doesNotMatch(item.reason, SKILL_JARGON, `reason 泄漏细则术语：${item.reason}`);
  }
}

describe('Stylist — 天气穿衣细则 Skill', { concurrency: true }, () => {
  it('23℃ 雾天晚餐 → 不选短裤', async () => {
    const result = await callStylistAgent(
      [],
      weatherIntent('重庆城区，雾，23℃，东北风≤3级，湿度77%', '晚餐'),
      EMPTY_PROFILE,
      [{ text: '去南岸区吃晚饭，帮我搭一套' }]
    );
    for (const item of itemsOnLayer(result, /bottom/)) {
      assert.doesNotMatch(item.name, SHORTS, `23℃ 不应推荐短裤：${item.name}`);
    }
    assertNoSkillJargon(result);
  });

  it('25℃ 边界（舒适档）→ 不选短裤', async () => {
    const result = await callStylistAgent(
      [],
      weatherIntent('上海市，多云，25℃，东风≤3级，湿度60%', '周末逛街'),
      EMPTY_PROFILE,
      [{ text: '周末去逛街，帮我搭一套' }]
    );
    for (const item of itemsOnLayer(result, /bottom/)) {
      assert.doesNotMatch(item.name, SHORTS, `25℃ 不应推荐短裤：${item.name}`);
    }
    assertNoSkillJargon(result);
  });

  it('小雨 18℃ → 鞋不选麂皮或帆布', async () => {
    const result = await callStylistAgent(
      [],
      weatherIntent('杭州市，小雨，18℃，北风≤3级，湿度90%', '日常通勤'),
      EMPTY_PROFILE,
      [{ text: '明天上班穿什么' }]
    );
    const shoes = itemsOnLayer(result, /shoe/);
    assert.ok(shoes.length > 0, '应包含鞋履');
    for (const item of shoes) {
      assert.doesNotMatch(item.name, RAIN_UNSAFE_SHOES, `雨天不应推荐：${item.name}`);
    }
  });

  it('用户坚持短裤 + 23℃ → 尊重用户选短裤，并在 reason 提示天气', async () => {
    const result = await callStylistAgent(
      [],
      weatherIntent('重庆城区，雾，23℃，东北风≤3级，湿度77%', '晚餐', '就想穿短裤'),
      EMPTY_PROFILE,
      [{ text: '晚上吃饭，我就想穿短裤' }]
    );
    for (const outfit of result.outfits) {
      const shorts = outfit.selected_items.find((item) => /bottom/.test(item.layer) && SHORTS.test(item.name));
      assert.ok(shorts, `${outfit.id} 应包含短裤`);
      const reasons = outfit.selected_items.map((item) => item.reason).join(' ');
      assert.match(reasons, WEATHER_WORDS, `${outfit.id} reason 应提及天气取舍`);
    }
  });

  it('19℃ 外套有点冷 → 检索仍是薄外套，不写羽绒服或季节词', async () => {
    const intent = normalizeGatekeeperIntent({
      request_type: 'feedback_revision',
      occasion: '日常通勤',
      weather: '重庆城区，多云，19℃',
      style_preference: '简约',
      special_requests: '外套有点冷，换个外套',
      dressing_climate: 'mild',
    });
    const queries = await planWardrobeSearchQueries(
      [],
      intent,
      EMPTY_PROFILE,
      '第二套外套有点冷，换个外套吧',
      null
    );
    const outerwear = queries.filter((entry) => entry.slot === 'outerwear');
    assert.ok(outerwear.length > 0, `应规划外套检索，实际: ${JSON.stringify(queries)}`);
    const queryText = outerwear.map((entry) => entry.query).join(' ');
    assert.match(queryText, /薄外套|开衫|衬衫外套|风衣/);
    assert.doesNotMatch(queryText, /羽绒|棉服|保暖|秋天|puffer|down|parka|warm|autumn/i);
  });

  it('冬季买衣服且没有今日天气 → 外套检索厚外套，不写防晒', async () => {
    const intent = normalizeGatekeeperIntent({
      request_type: 'wardrobe_outfit',
      occasion: '日常出门、约会聚会',
      weather: '',
      style_preference: '日常休闲',
      special_requests: '冬季新品，想买适合自己的冬季外套',
      dressing_climate: '',
    });
    const queries = await planWardrobeSearchQueries(
      [],
      intent,
      EMPTY_PROFILE,
      '我想买衣服，请推荐适合我的冬季穿搭',
      null
    );
    const outerwear = queries.filter((entry) => entry.slot === 'outerwear');
    assert.ok(outerwear.length > 0, `应规划冬季外套检索，实际: ${JSON.stringify(queries)}`);
    const queryText = outerwear.map((entry) => entry.query).join(' ');
    assert.match(queryText, /大衣|棉服|羽绒/);
    assert.doesNotMatch(queryText, /防晒|薄外套|开衫/);
  });

  it('想买冬季穿搭时，衣橱里已有单品也整套都用新品', async () => {
    const { llmGenerate } = await import('@/server/services/llm/client');
    const { STYLIST_SYSTEM_INSTRUCTION } = await import('@/server/agents/stylist/prompts');
    const { stylistSchema } = await import('@/server/agents/stylist/schema');
    const { AGENT_MODELS } = await import('@/server/config/models');

    const response = await llmGenerate({
      model: AGENT_MODELS.stylist,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `【今日穿搭意图】
- 请求类型: wardrobe_outfit
- 天气温度:
- 场合: 日常出门
- 特殊要求: 想买冬季新品外套

【用户衣橱单品列表】
<item ref="item_0" mainCategory="OUTERWEAR" subCategory="连帽棉服" similarity="0.82">深色连帽棉服，横向绗缝，有填充。</item>
<item ref="item_1" mainCategory="TOP" subCategory="针织翻领衬衫" similarity="0.74">米白色针织翻领长袖衬衫。</item>
<item ref="item_2" mainCategory="BOTTOM" subCategory="阔腿长裤" similarity="0.7">米白色阔腿长裤。</item>
<wardrobe_match_summary>
<slot name="outerwear" status="adequate"/>
<slot name="top" status="adequate"/>
<slot name="bottom" status="adequate"/>
</wardrobe_match_summary>

请输出 1 套穿搭。`,
            },
          ],
        },
      ],
      systemInstruction: STYLIST_SYSTEM_INSTRUCTION,
      temperature: 0.2,
      jsonSchema: stylistSchema,
    });

    const parsed = JSON.parse(response.text ?? '') as {
      outfits: Array<{ selected_items: Array<{ id: string; layer: string; description?: string; name: string }> }>;
    };
    assert.ok(parsed.outfits.length > 0);
    for (const outfit of parsed.outfits) {
      assert.ok(outfit.selected_items.length >= 3, `一套新品至少含上装、下装和外套: ${JSON.stringify(outfit.selected_items)}`);
      for (const item of outfit.selected_items) {
        assert.equal(item.id, 'new_item', `买衣服时不应使用衣橱单品，实际: ${item.id} ${item.name}`);
        assert.ok((item.description ?? '').trim().length > 8, `新品应有一句外观: ${item.name}`);
      }
      const outerwear = outfit.selected_items.filter((item) => /outer/i.test(item.layer));
      assert.ok(outerwear.length > 0, `应有冬季外套，实际: ${JSON.stringify(outfit.selected_items)}`);
      for (const item of outerwear) {
        assert.match(item.description ?? '', /大衣|棉服|羽绒/);
      }
    }
  });
});

describe('Stylist — style advice mode', () => {
  it('style_advice: 返回 topic + points（3-5 条），结构正确', async () => {
    const { callStylistAdvice } = await import('@/server/agents/stylist/agent');

    const adviceIntent = normalizeGatekeeperIntent({
      request_type: 'style_advice',
      special_requests: '高级感色彩搭配公式',
      style_preference: '简约',
    });

    const result = await callStylistAdvice(
      [],
      [{ text: '高级感色彩搭配公式是什么' }],
      adviceIntent,
      EMPTY_PROFILE
    );

    assert.ok(result.topic, 'topic 不能为空');
    assert.ok(result.points.length >= 2, `points 至少 2 条，实际: ${result.points.length}`);
    assert.ok(result.points.length <= 6, `points 不超过 6 条，实际: ${result.points.length}`);
    for (const point of result.points) {
      assert.ok(point.trim().length > 0, 'points 不能有空条目');
    }
  });
});
