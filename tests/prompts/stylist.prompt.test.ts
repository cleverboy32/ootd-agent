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
import { callStylistAgent } from '@/server/agents/stylist/agent';
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
    embedding: null,
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
  /knee[-\s]?length|ankle[-\s]?length|midi|maxi|cropped|above[-\s]?the[-\s]?knee|wide[-\s]?leg|straight[-\s]?leg|short|shorts|mini|floor[-\s]?length/i;

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
