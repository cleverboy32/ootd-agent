import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCopywriterTagContext,
  createCopywriterStreamSanitizer,
  sanitizeCopywriterTags,
  type CopywriterTagContext,
} from '@/server/utils/copywriterTagSanitizer';

const WARDROBE_ID = 'cmqg5ec6b0000pvs8q5kp2358';
const OUTFIT_ID = 'outfit_1';

const stylistFixture = {
  outfits: [
    {
      id: OUTFIT_ID,
      selected_items: [
        { id: WARDROBE_ID },
        { id: 'new_item' },
      ],
    },
    {
      id: 'outfit_2',
      selected_items: [{ id: 'item_abc' }],
    },
  ],
};

function makeContext(): CopywriterTagContext {
  return buildCopywriterTagContext(stylistFixture);
}

describe('buildCopywriterTagContext', () => {
  it('collects wardrobe ids excluding new_item and all outfit ids', () => {
    const ctx = makeContext();
    assert.equal(ctx.wardrobeIds.has(WARDROBE_ID), true);
    assert.equal(ctx.wardrobeIds.has('item_abc'), true);
    assert.equal(ctx.wardrobeIds.has('new_item'), false);
    assert.equal(ctx.outfitIds.has(OUTFIT_ID), true);
    assert.equal(ctx.outfitIds.has('outfit_2'), true);
  });
});

describe('sanitizeCopywriterTags — wardrobe variants', () => {
  const ctx = makeContext();
  const expected = `[衣橱物品:id=${WARDROBE_ID}]`;

  const cases: Array<{ name: string; input: string }> = [
    { name: '{{W:id}} token', input: `推荐 {{W:${WARDROBE_ID}}}` },
    { name: '{{W: id }} with spaces', input: `{{W: ${WARDROBE_ID} }}` },
    { name: '{{WARDROBE:id}} token', input: `{{WARDROBE:${WARDROBE_ID}}}` },
    { name: '{{衣橱物品:id}} token', input: `{{衣橱物品:${WARDROBE_ID}}}` },
    { name: 'canonical markdown tag', input: `[衣橱物品:id=${WARDROBE_ID}]` },
    { name: 'drifted tag without id=', input: `[衣橱物品:${WARDROBE_ID}]` },
    { name: 'full-width brackets', input: `【衣橱物品:id=${WARDROBE_ID}】` },
    {
      name: 'real-world sentence',
      input: `下半身推荐搭配您衣橱里的[衣橱物品:${WARDROBE_ID}]。浅蓝色牛仔裤。`,
    },
  ];

  for (const { name, input } of cases) {
    it(name, () => {
      assert.equal(sanitizeCopywriterTags(input, ctx), input.replace(/\[衣橱物品[^\]]+\]|【衣橱物品[^】]+】|\{\{[^}]+\}\}/g, expected));
      assert.ok(sanitizeCopywriterTags(input, ctx).includes(expected));
    });
  }
});

describe('sanitizeCopywriterTags — image variants', () => {
  const ctx = makeContext();
  const expected = `[IMAGE=${OUTFIT_ID}]`;

  const cases: Array<{ name: string; input: string }> = [
    { name: '{{IMG:id}} token', input: `\n\n{{IMG:${OUTFIT_ID}}}\n\n` },
    { name: '{{IMAGE:id}} token', input: `{{IMAGE:${OUTFIT_ID}}}` },
    { name: 'canonical [IMAGE=]', input: `[IMAGE=${OUTFIT_ID}]` },
    { name: 'drifted [IMAGE: ]', input: `[IMAGE: ${OUTFIT_ID}]` },
    { name: 'lowercase [image=]', input: `[image=${OUTFIT_ID}]` },
  ];

  for (const { name, input } of cases) {
    it(name, () => {
      assert.ok(sanitizeCopywriterTags(input, ctx).includes(expected));
    });
  }
});

describe('sanitizeCopywriterTags — unknown ids', () => {
  it('recovers garbled wardrobe id with short character insertion (real earring bug)', () => {
    const realId = 'cmqhl8x14000hbis86akg7xwi';
    const garbled = 'cmqg5hl8x14000hbis86akg7xwi'; // inserted "g5"
    const ctx: CopywriterTagContext = {
      wardrobeIds: new Set([realId, WARDROBE_ID]),
      outfitIds: new Set([OUTFIT_ID]),
    };
    const warn = mock.fn();
    const original = console.warn;
    console.warn = warn;

    try {
      const result = sanitizeCopywriterTags(`[衣橱物品:id=${garbled}]`, ctx);
      assert.equal(result, `[衣橱物品:id=${realId}]`);
      assert.equal(warn.mock.calls.length, 1);
      assert.match(String(warn.mock.calls[0].arguments[0]), /Recovered garbled/);
    } finally {
      console.warn = original;
    }
  });

  it('drops unrecoverable unknown wardrobe id instead of emitting Item-not-found tag', () => {
    const ctx = makeContext();
    const warn = mock.fn();
    const original = console.warn;
    console.warn = warn;

    try {
      const result = sanitizeCopywriterTags('配饰：戴上这对[衣橱物品:unknown_id]，很衬肤色。', ctx);
      assert.equal(result.includes('[衣橱物品'), false);
      assert.match(result, /配饰：戴上这对，很衬肤色。/);
      assert.equal(warn.mock.calls.length, 1);
      assert.match(String(warn.mock.calls[0].arguments[0]), /Unknown wardrobe id/);
    } finally {
      console.warn = original;
    }
  });
});

describe('createCopywriterStreamSanitizer', () => {
  const ctx = makeContext();
  const expected = `[衣橱物品:id=${WARDROBE_ID}]`;

  it('reassembles wardrobe token split across chunks', () => {
    const sanitizer = createCopywriterStreamSanitizer(ctx);
    const token = `{{W:${WARDROBE_ID}}}`;
    const splitAt = 4;

    const part1 = sanitizer.process(token.slice(0, splitAt));
    const part2 = sanitizer.process(token.slice(splitAt));
    const tail = sanitizer.flush();

    assert.equal(part1 + part2 + tail, expected);
  });

  it('reassembles drifted markdown tag split across chunks', () => {
    const sanitizer = createCopywriterStreamSanitizer(ctx);
    const token = `[衣橱物品:${WARDROBE_ID}]`;
    const splitAt = 6;

    const part1 = sanitizer.process(token.slice(0, splitAt));
    const part2 = sanitizer.process(token.slice(splitAt));
    const tail = sanitizer.flush();

    assert.equal(part1 + part2 + tail, expected);
  });

  it('passes through plain text immediately', () => {
    const sanitizer = createCopywriterStreamSanitizer(ctx);
    assert.equal(sanitizer.process('亲爱的，'), '亲爱的，');
    assert.equal(sanitizer.flush(), '');
  });
});
