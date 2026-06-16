import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCopywriterOutput } from './copywriterEvaluator';

const WARDROBE_ID = 'cmqg5ec6b0000pvs8q5kp2358';

const stylistFixture = {
  outfits: [
    {
      id: 'outfit_1',
      selected_items: [
        { id: WARDROBE_ID, name: '工装牛仔裤' },
        { id: 'new_item', name: '白色T恤' },
      ],
    },
    {
      id: 'outfit_2',
      selected_items: [{ id: 'item_abc', name: '风衣' }],
    },
  ],
};

describe('evaluateCopywriterOutput', () => {
  it('passes when all required tags are present', () => {
    const text = `
### 方案一
推荐 [衣橱物品:id=${WARDROBE_ID}] 和白色T恤 🛍️

[IMAGE=outfit_1]

### 方案二
[衣橱物品:id=item_abc]

[IMAGE=outfit_2]
`;

    const result = evaluateCopywriterOutput(text, stylistFixture);
    assert.equal(result.passed, true);
    assert.equal(result.score, 100);
    assert.equal(result.issues.length, 0);
  });

  it('fails when wardrobe tag is missing', () => {
    const text = `[IMAGE=outfit_1]\n\n[IMAGE=outfit_2]`;
    const result = evaluateCopywriterOutput(text, stylistFixture);

    assert.equal(result.passed, false);
    assert.ok(result.issues.some((i) => i.code === 'MISSING_WARDROBE_TAG'));
    assert.ok(result.issues.some((i) => i.code === 'MISSING_NEW_ITEM_MARKER'));
  });

  it('fails when image placeholder is missing', () => {
    const text = `推荐 [衣橱物品:id=${WARDROBE_ID}] 🛍️`;
    const result = evaluateCopywriterOutput(text, stylistFixture);

    assert.equal(result.passed, false);
    assert.ok(result.issues.some((i) => i.code === 'MISSING_IMAGE_PLACEHOLDER'));
  });

  it('fails on unknown wardrobe id', () => {
    const text = `[衣橱物品:id=not_in_stylist]\n\n[IMAGE=outfit_1]\n\n[IMAGE=outfit_2]`;
    const result = evaluateCopywriterOutput(text, stylistFixture);

    assert.equal(result.passed, false);
    assert.ok(result.issues.some((i) => i.code === 'UNKNOWN_WARDROBE_ID'));
  });

  it('fails on residual unsanitized tokens', () => {
    const text = `{{W:${WARDROBE_ID}}}\n\n[IMAGE=outfit_1]\n\n[IMAGE=outfit_2]`;
    const result = evaluateCopywriterOutput(text, stylistFixture);

    assert.equal(result.passed, false);
    assert.ok(result.issues.some((i) => i.code === 'RESIDUAL_RAW_TOKEN'));
  });

  it('warns on letter-style closing like 展信佳', () => {
    const text = `
### 方案一
[衣橱物品:id=${WARDROBE_ID}] 🛍️

[IMAGE=outfit_1]

[IMAGE=outfit_2]

展信佳
`;
    const result = evaluateCopywriterOutput(text, stylistFixture);
    assert.ok(result.issues.some((i) => i.code === 'LETTER_STYLE_CLOSING'));
  });
});
