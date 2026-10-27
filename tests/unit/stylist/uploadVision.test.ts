import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GatekeeperIntent } from '@/server/agents/intent';
import {
  IGNORED_UPLOAD_NOTE,
  NOT_A_GARMENT_REPLY,
  decideUploadVision,
  normalizeSeenGarments,
  latestSessionUploadUrls,
  rememberedUploadGarments,
  releaseDeicticUpload,
  resolveStylistUploadUrls,
  textNeedsUpload,
} from '@/server/agents/stylist/uploadVision';

function intent(partial: Partial<GatekeeperIntent>): GatekeeperIntent {
  return {
    weather: '',
    city: '',
    city_role: '',
    occasion: '开会',
    style_preference: '日常休闲',
    special_requests: '',
    request_type: 'wardrobe_outfit',
    anchor_item_summary: '',
    anchor_slot: '',
    dressing_climate: '',
    ...partial,
  };
}

describe('decideUploadVision', () => {
  it('keeps garments and drops the unrelated upload', () => {
    const decision = decideUploadVision({
      intent: intent({ request_type: 'wardrobe_outfit' }),
      imageUrls: ['https://cdn.example/shirt.jpg', 'https://cdn.example/meme.jpg'],
      garments: [{ index: 0, slot: 'top', identity: '浅粉白细条纹宽松长袖衬衫' }],
      textDependsOnImage: false,
      userMessage: '明天开会怎么穿',
    });

    assert.equal(decision.type, 'continue');
    if (decision.type !== 'continue') return;
    assert.equal(decision.intent.request_type, 'purchase_pairing');
    assert.equal(decision.intent.purchase_items?.length, 1);
    assert.equal(decision.intent.purchase_items?.[0]?.imageUrl, 'https://cdn.example/shirt.jpg');
    assert.equal(decision.intent.anchor_item_summary, '浅粉白细条纹宽松长袖衬衫');
    assert.equal(decision.intent.anchor_slot, 'top');
    assert.equal(decision.ignoredUploadNote, '');
  });

  it('replies when the words need the picture and nothing is clothing', () => {
    const decision = decideUploadVision({
      intent: intent({ request_type: 'purchase_pairing', occasion: '日常百搭' }),
      imageUrls: ['https://cdn.example/cat.jpg'],
      garments: [],
      textDependsOnImage: false,
      userMessage: '帮我搭这个',
    });

    assert.deepEqual(decision, { type: 'reply', reply: NOT_A_GARMENT_REPLY });
  });

  it('drops a non-clothing photo when the text already asks for an outfit', () => {
    const decision = decideUploadVision({
      intent: intent({
        request_type: 'purchase_pairing',
        anchor_item_summary: '用户上传的待购单品',
        anchor_slot: '',
        purchase_vision_pending: true,
        special_requests: '用户待购单品（用户上传的待购单品）需作为搭配锚点，从衣橱中选取互补单品与之搭配',
      }),
      imageUrls: ['https://cdn.example/view.jpg'],
      garments: [],
      textDependsOnImage: false,
      userMessage: '明天开会怎么穿',
    });

    assert.equal(decision.type, 'continue');
    if (decision.type !== 'continue') return;
    assert.equal(decision.intent.request_type, 'wardrobe_outfit');
    assert.equal(decision.intent.anchor_item_summary, '');
    assert.equal(decision.intent.purchase_items?.length ?? 0, 0);
    assert.equal(decision.intent.special_requests, '');
    assert.equal(decision.ignoredUploadNote, IGNORED_UPLOAD_NOTE);
  });

  it('leaves revision intents untouched', () => {
    const original = intent({ request_type: 'feedback_revision', special_requests: '鞋换成白色' });
    const decision = decideUploadVision({
      intent: original,
      imageUrls: ['https://cdn.example/cat.jpg'],
      garments: [],
      textDependsOnImage: true,
      userMessage: '鞋换成白色',
    });

    assert.equal(decision.type, 'continue');
    if (decision.type !== 'continue') return;
    assert.equal(decision.intent, original);
    assert.equal(decision.ignoredUploadNote, '');
  });
});

describe('normalizeSeenGarments', () => {
  it('accepts 1-based indexes and drops invalid slots', () => {
    const garments = normalizeSeenGarments(
      [
        { index: 2, slot: 'bottom', identity: '米白解构阔腿长裤' },
        { index: 2, slot: 'bottom', identity: '重复' },
        { index: 1, slot: 'hat', identity: '帽子' },
      ],
      2
    );

    assert.deepEqual(garments, [{ index: 1, slot: 'bottom', identity: '米白解构阔腿长裤' }]);
  });
});

describe('releaseDeicticUpload', () => {
  it('sends a deictic clarify through so the stylist can look', () => {
    const released = releaseDeicticUpload(
      intent({ request_type: 'clarify', occasion: '' }),
      1,
      '帮我搭这个'
    );

    assert.equal(released.request_type, 'purchase_pairing');
    assert.equal(released.purchase_vision_pending, true);
    assert.equal(released.occasion, '日常百搭');
  });

  it('keeps a standalone outfit request on its own route', () => {
    const original = intent({ request_type: 'wardrobe_outfit' });
    assert.equal(releaseDeicticUpload(original, 1, '明天开会怎么穿'), original);
  });
});

describe('resolveStylistUploadUrls', () => {
  it('reuses both photos from the latest upload when the whole outfit is rejected', () => {
    const urls = resolveStylistUploadUrls(
      [],
      { request_type: 'outfit_redo', purchase_vision_pending: true },
      [
        { messageId: 'older', imageUrl: 'https://example.com/old-shirt.jpg' },
        { messageId: 'older', imageUrl: 'https://example.com/old-pants.jpg' },
        { messageId: 'latest', imageUrl: ' https://example.com/shirt.jpg ' },
        { messageId: 'latest', imageUrl: 'https://example.com/pants.jpg' },
      ]
    );
    assert.deepEqual(urls, ['https://example.com/shirt.jpg', 'https://example.com/pants.jpg']);
  });

  it('keeps this turn’s uploads ahead of older session photos', () => {
    const urls = resolveStylistUploadUrls(
      ['https://example.com/new.jpg'],
      { request_type: 'outfit_redo', purchase_vision_pending: true },
      [{ messageId: 'old', imageUrl: 'https://example.com/old.jpg' }]
    );
    assert.deepEqual(urls, ['https://example.com/new.jpg']);
  });
});

describe('latestSessionUploadUrls', () => {
  it('keeps every image that arrived in the same message', () => {
    assert.deepEqual(
      latestSessionUploadUrls([
        { messageId: 'a', imageUrl: 'https://example.com/1.jpg' },
        { messageId: 'b', imageUrl: 'https://example.com/2.jpg' },
        { messageId: 'b', imageUrl: 'https://example.com/3.jpg' },
      ]),
      ['https://example.com/2.jpg', 'https://example.com/3.jpg']
    );
  });
});

describe('rememberedUploadGarments', () => {
  const shirt = 'https://example.com/shirt.jpg';
  const pants = 'https://example.com/pants.jpg';

  it('keeps the first identity when a later redo misnames the same photo', () => {
    const remembered = rememberedUploadGarments(
      [
        {
          purchase_image_urls: [shirt, pants],
          outfits: [
            {
              selected_items: [
                { id: 'new_item', name: '浅粉白竖条纹衬衫', layer: 'inner_top', description: '浅粉白竖条纹衬衫，胸前有贴袋' },
                { id: 'new_item', name: '米白色阔腿长裤', layer: 'bottom', description: '米白色阔腿长裤，裤腿有斜向分割线' },
                { id: 'new_item', name: '深棕乐福鞋', layer: 'shoes', description: '深棕色乐福鞋' },
              ],
            },
            {
              selected_items: [
                { id: 'new_item', name: '浅粉白竖条纹衬衫', layer: 'inner_top', description: '浅粉白竖条纹衬衫，胸前有贴袋' },
                { id: 'new_item', name: '米白色阔腿长裤', layer: 'bottom', description: '米白色阔腿长裤，裤腿有斜向分割线' },
                { id: 'new_item', name: '橄榄绿开衫', layer: 'outerwear', description: '深橄榄绿开衫' },
              ],
            },
          ],
        },
        {
          purchase_image_urls: [shirt, pants],
          outfits: [
            {
              selected_items: [
                { id: 'new_item', name: '粉白细条纹长袖衬衫', layer: 'inner_top', description: '粉白细条纹长袖衬衫' },
                { id: 'new_item', name: '深棕色长袖上衣', layer: 'inner_top', description: '深棕色长袖上衣' },
              ],
            },
            {
              selected_items: [
                { id: 'new_item', name: '粉白细条纹长袖衬衫', layer: 'inner_top', description: '粉白细条纹长袖衬衫' },
                { id: 'new_item', name: '深棕色长袖上衣', layer: 'inner_top', description: '深棕色长袖上衣' },
                { id: 'new_item', name: '深棕半身裙', layer: 'bottom', description: '深棕色半身裙' },
              ],
            },
          ],
        },
      ],
      [shirt, pants]
    );

    assert.deepEqual(
      remembered?.map((item) => item.identity),
      ['浅粉白竖条纹衬衫，胸前有贴袋', '米白色阔腿长裤，裤腿有斜向分割线']
    );
    assert.equal(remembered?.[1]?.slot, 'bottom');
  });
});

describe('textNeedsUpload', () => {
  it('treats a deictic request as needing the picture', () => {
    assert.equal(textNeedsUpload('帮我搭这个', false), true);
    assert.equal(textNeedsUpload('明天开会怎么穿', false), false);
    assert.equal(textNeedsUpload('明天开会怎么穿', true), true);
  });
});
