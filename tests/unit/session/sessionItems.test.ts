import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractSessionItemsFromMessages,
  mergeCurrentImageIntoSessionItems,
  formatSessionItemsForGate,
  resolveAnchorUrlFromSessionItems,
  buildAdditionalPurchaseImageRefs,
} from '@/server/utils/sessionItems';
import { resolveSessionItemBinding } from '@/server/agents/intent/utils';
import type { GatekeeperIntent } from '@/server/agents/intent';
import type { Message } from '@/server/types/message';

function userMsg(
  id: string,
  parts: Array<{ type: string; content?: string }>,
  imageUrl?: string
): Message {
  return {
    id,
    role: 'user',
    content: parts,
    imageUrl,
  } as Message;
}

describe('extractSessionItemsFromMessages', () => {
  it('orders user upload images as si_1… and keeps hint text', () => {
    const items = extractSessionItemsFromMessages([
      userMsg('m1', [
        { type: 'text', content: '打算买这条裤子' },
        { type: 'image', content: 'https://cdn.example/pants.jpg' },
      ]),
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', content: '方案' }],
      } as Message,
      userMsg('m2', [
        { type: 'text', content: '再看看这件上衣' },
        { type: 'image', content: 'https://cdn.example/top.jpg' },
      ]),
    ]);

    assert.equal(items.length, 2);
    assert.equal(items[0].id, 'si_1');
    assert.equal(items[0].imageUrl, 'https://cdn.example/pants.jpg');
    assert.match(items[0].hintText, /裤子/);
    assert.equal(items[1].id, 'si_2');
    assert.equal(items[1].imageUrl, 'https://cdn.example/top.jpg');
  });

  it('supports legacy imageUrl field', () => {
    const items = extractSessionItemsFromMessages([
      userMsg('m1', [{ type: 'text', content: '旧字段' }], 'https://cdn.example/legacy.jpg'),
    ]);
    assert.equal(items[0].imageUrl, 'https://cdn.example/legacy.jpg');
  });

  it('mergeCurrentImageIntoSessionItems appends unseen url', () => {
    const base = extractSessionItemsFromMessages([
      userMsg('m1', [{ type: 'image', content: 'https://cdn.example/a.jpg' }]),
    ]);
    const merged = mergeCurrentImageIntoSessionItems(base, 'https://cdn.example/b.jpg');
    assert.equal(merged.length, 2);
    assert.equal(merged[1].id, 'si_2');
    assert.equal(mergeCurrentImageIntoSessionItems(base, 'https://cdn.example/a.jpg').length, 1);
  });

  it('formatSessionItemsForGate lists ids for Gate', () => {
    const text = formatSessionItemsForGate([
      { id: 'si_1', messageId: 'm1', imageUrl: 'https://x/a.jpg', hintText: '裤子' },
    ]);
    assert.match(text, /会话待购单品/);
    assert.match(text, /si_1/);
    assert.match(text, /裤子/);
  });
});

describe('resolveAnchorUrlFromSessionItems', () => {
  it('recovers url from si_N mention when cache has no anchor_image_url', () => {
    const url = resolveAnchorUrlFromSessionItems(
      [
        { id: 'si_1', messageId: 'm1', imageUrl: 'https://cdn.example/pants.jpg', hintText: '裤子' },
        { id: 'si_2', messageId: 'm2', imageUrl: 'https://cdn.example/top.jpg', hintText: '上衣' },
      ],
      '必须将会话待购单品 si_1 原样作为搭配锚点'
    );
    assert.equal(url, 'https://cdn.example/pants.jpg');
  });

  it('falls back to sole session item', () => {
    const url = resolveAnchorUrlFromSessionItems(
      [{ id: 'si_1', messageId: 'm1', imageUrl: 'https://cdn.example/pants.jpg', hintText: '' }],
      '裤子不对'
    );
    assert.equal(url, 'https://cdn.example/pants.jpg');
  });
});

describe('buildAdditionalPurchaseImageRefs', () => {
  it('adds pants session photo when outfit has jacket+pants new_items', () => {
    const refs = buildAdditionalPurchaseImageRefs(
      {
        selected_items: [
          { id: 'new_item', name: '黑色短款机车皮衣', layer: 'outerwear' },
          { id: 'new_item', name: '深灰色高腰阔腿裤', layer: 'bottom' },
        ],
      },
      [
        { id: 'si_1', messageId: 'm1', imageUrl: 'https://cdn.example/pants.jpg', hintText: '打算买这条裤子' },
        { id: 'si_2', messageId: 'm2', imageUrl: 'https://cdn.example/jacket.jpg', hintText: '这件皮衣' },
      ],
      'https://cdn.example/jacket.jpg'
    );
    assert.equal(refs.length, 1);
    assert.equal(refs[0].url, 'https://cdn.example/pants.jpg');
    assert.match(refs[0].label, /阔腿裤/);
  });

  it('returns empty when only one new_item', () => {
    const refs = buildAdditionalPurchaseImageRefs(
      { selected_items: [{ id: 'new_item', name: '黑色短款机车皮衣', layer: 'outerwear' }] },
      [
        { id: 'si_1', messageId: 'm1', imageUrl: 'https://cdn.example/pants.jpg', hintText: '裤子' },
        { id: 'si_2', messageId: 'm2', imageUrl: 'https://cdn.example/jacket.jpg', hintText: '皮衣' },
      ],
      'https://cdn.example/jacket.jpg'
    );
    assert.equal(refs.length, 0);
  });
});

describe('resolveSessionItemBinding', () => {
  const items = [
    { id: 'si_1', imageUrl: 'https://cdn.example/pants.jpg' },
    { id: 'si_2', imageUrl: 'https://cdn.example/top.jpg' },
  ];

  function baseIntent(partial: Partial<GatekeeperIntent>): GatekeeperIntent {
    return {
      weather: '',
      occasion: '日常',
      style_preference: '日常休闲',
      special_requests: '',
      request_type: 'purchase_pairing',
      anchor_item_summary: '深灰阔腿裤',
      anchor_slot: 'bottom',
      dressing_climate: '',
      ...partial,
    };
  }

  it('binds valid session_item_id to URL', () => {
    const bound = resolveSessionItemBinding(baseIntent({ session_item_id: 'si_1' }), items);
    assert.equal(bound.session_item_id, 'si_1');
    assert.equal(bound.anchor_image_url, 'https://cdn.example/pants.jpg');
  });

  it('clears session_item_id on feedback_revision', () => {
    const bound = resolveSessionItemBinding(
      baseIntent({ request_type: 'feedback_revision', session_item_id: 'si_1' }),
      items
    );
    assert.equal(bound.session_item_id, '');
  });

  it('matches currentImageUrl when id missing', () => {
    const bound = resolveSessionItemBinding(baseIntent({ session_item_id: '' }), items, items[1].imageUrl);
    assert.equal(bound.session_item_id, 'si_2');
    assert.equal(bound.anchor_image_url, items[1].imageUrl);
  });

  it('defaults to sole item when only one', () => {
    const bound = resolveSessionItemBinding(baseIntent({}), [items[0]]);
    assert.equal(bound.session_item_id, 'si_1');
  });
});
