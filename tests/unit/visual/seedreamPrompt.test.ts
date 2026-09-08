import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  buildModelSubjectDescription,
  buildSeedreamImagePrompt,
  simplifyVisualText,
} from '@/server/agents/visual/seedreamPrompt';
import type { StylistOutfit } from '@/server/agents/stylist';

const outfit: StylistOutfit = {
  id: 'outfit_1',
  overall_concept: '约会造型',
  selected_items: [{ id: 'item_0', name: 'Mini Dress', layer: 'dress', reason: '主单品' }],
  visual_composition: {
    model_pose: 'A fashion model standing gracefully on a café terrace',
    outfit_details: 'mint mini dress with lace hem',
    background: 'A romantic outdoor café terrace at golden hour, warm glowing string lights',
  },
};

describe('simplifyVisualText', () => {
  it('strips fashion model / editorial cues', () => {
    const simplified = simplifyVisualText('A fashion model standing gracefully, cinematic editorial');
    assert.doesNotMatch(simplified, /fashion model/i);
    assert.doesNotMatch(simplified, /editorial/i);
  });
});

describe('buildModelSubjectDescription', () => {
  const original = process.env.IMAGE_MODEL_SUBJECT;

  after(() => {
    if (original === undefined) delete process.env.IMAGE_MODEL_SUBJECT;
    else process.env.IMAGE_MODEL_SUBJECT = original;
  });

  it('defaults to Chinese/Asian subject', () => {
    delete process.env.IMAGE_MODEL_SUBJECT;
    assert.match(buildModelSubjectDescription(null), /中国年轻女性/);
    assert.match(buildModelSubjectDescription(null), /东亚面孔/);
  });

  it('uses verified profile fields when available', () => {
    delete process.env.IMAGE_MODEL_SUBJECT;
    const desc = buildModelSubjectDescription({
      name: '',
      height: '165cm',
      weight: '',
      preferences: [],
      skin_tone: '暖色调',
      body_shape: '匀称',
      personal_style: '休闲',
      visual_features: { hair_color: '深棕色', detected_features: 'none' },
    });
    assert.match(desc, /165cm/);
    assert.match(desc, /深棕色/);
  });
});

describe('buildSeedreamImagePrompt', () => {
  it('uses Chinese realism keywords and 图N references', () => {
    const prompt = buildSeedreamImagePrompt(
      outfit,
      undefined,
      ['Mini Dress (dress) | mint'],
      null
    );
    assert.match(prompt, /真实街拍/);
    assert.match(prompt, /东亚|中国/);
    assert.match(prompt, /图1/);
    assert.doesNotMatch(prompt, /Fashion editorial/i);
    assert.match(prompt, /避免过度磨皮|塑料感/);
  });

  it('emphasizes full-outfit look when accessories are present', () => {
    const withAcc: StylistOutfit = {
      ...outfit,
      selected_items: [
        ...outfit.selected_items,
        { id: 'acc', name: 'Choker', layer: 'accessory', reason: 'accent' },
      ],
    };
    const prompt = buildSeedreamImagePrompt(
      withAcc,
      undefined,
      ['Mini Dress (dress)'],
      null
    );
    assert.match(prompt, /整套穿搭为主|完整造型/);
    assert.match(prompt, /点缀|融入整体/);
    assert.doesNotMatch(prompt, /配饰特写|配饰比例【强制】|耳垂大小/);
  });

  it('keeps outfit text and open-layering when refs exist but inner is text-only', () => {
    const layered: StylistOutfit = {
      ...outfit,
      selected_items: [
        { id: 'new_item', name: '修身奶油色短袖T恤', layer: 'inner_top', reason: '内搭新品' },
        { id: 'ow', name: '黑色机车皮衣', layer: 'outerwear', reason: '外套' },
        { id: 'bt', name: '格纹半裙', layer: 'bottom', reason: '下装' },
      ],
      visual_composition: {
        model_pose: 'standing casually',
        outfit_details: 'leather jacket worn open over cream tee with plaid skirt',
        background: 'brick wall afternoon light',
      },
    };
    const prompt = buildSeedreamImagePrompt(
      layered,
      undefined,
      ['黑色机车皮衣 (outerwear) — anchor garment'],
      null
    );
    assert.match(prompt, /整套穿着/);
    assert.match(prompt, /leather jacket worn open/);
    assert.match(prompt, /穿搭构成/);
    assert.match(prompt, /无参考图单品/);
    assert.match(prompt, /修身奶油色短袖T恤/);
    assert.match(prompt, /叠穿层次/);
    assert.match(prompt, /敞开或半敞/);
  });

  it('injects full wardrobe descriptions so front pleats are not lost to label truncation', () => {
    const pantsOutfit: StylistOutfit = {
      ...outfit,
      selected_items: [
        { id: 'pants-1', name: 'Wide-Leg Trousers', layer: 'bottom', reason: '下装' },
      ],
      visual_composition: {
        model_pose: 'standing',
        // Stylist 概括词：容易诱导满裤褶皱
        outfit_details: 'cream ankle-length high-waist wide-leg pleated trousers',
        background: 'hotel lobby',
      },
    };
    const ragCache = new Map([
      [
        'pants-1',
        {
          id: 'pants-1',
          description:
            'Cream wide-leg trousers with front pleats, an elastic back waistband, and a patterned drawstring belt with tassel ends.',
        } as never,
      ],
    ]);
    const prompt = buildSeedreamImagePrompt(
      pantsOutfit,
      ragCache,
      [
        'Wide-Leg Trousers | bottom | Cream wide-leg trousers with front pleats, an elastic back waistband, and a patterned drawstring belt with tassel ends.',
      ],
      null
    );
    assert.match(prompt, /衣橱单品原文/);
    assert.match(prompt, /front pleats/);
    assert.match(prompt, /以衣橱原文|结构细节以此为准/);
    // 参考图短标签不应把整段 description 硬塞进 48 字窗口后静默丢失语义来源
    assert.doesNotMatch(prompt, /图1Wide-Leg Trousers \| bottom \| BOTTOM/);
  });
});
