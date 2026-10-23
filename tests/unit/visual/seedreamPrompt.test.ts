import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  buildModelSubjectDescription,
  buildSeedreamImagePrompt,
  SEEDREAM_SYSTEM_INSTRUCTION,
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

  it('skips the generic subject when a full-body reference is present', () => {
    process.env.IMAGE_MODEL_SUBJECT = '固定模特';
    assert.equal(buildModelSubjectDescription(null, { hasPersonReference: true }), '');
  });
});

describe('buildSeedreamImagePrompt', () => {
  it('keeps the person photo off the garment list', () => {
    const prompt = buildSeedreamImagePrompt(
      outfit,
      undefined,
      [
        '人物参考（只取脸、发型、肤色和身体比例，禁止穿这张照片里的衣服）',
        'Mini Dress (dress) | mint',
      ],
      null
    );
    assert.match(prompt, /五官、脸型、眼睛、鼻子、嘴唇、发型和身体比例都跟图1/);
    assert.match(prompt, /禁止换脸/);
    assert.match(prompt, /轻度整理皮肤/);
    assert.match(prompt, /保留毛孔/);
    assert.match(prompt, /禁止拉腿/);
    assert.match(prompt, /脸是图1本人/);
    assert.match(prompt, /禁止复制图1里的服装/);
    assert.match(prompt, /穿齐图2至图2/);
    assert.doesNotMatch(prompt, /中国年轻女性/);
    assert.doesNotMatch(prompt, /穿齐图1/);
  });

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
    assert.match(prompt, /中国年轻女性/);
    assert.doesNotMatch(prompt, /Fashion editorial/i);
    assert.match(prompt, /磨皮|塑料/);
    assert.doesNotMatch(prompt, /85mm/);
    assert.match(prompt, /禁止浅景深/);
    assert.match(prompt, /起毛与罗纹/);
    assert.match(prompt, /禁止自行加渐变水洗/);
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
        {
          id: 'new_item',
          name: '修身奶油色短袖T恤',
          layer: 'inner_top',
          reason: '内搭新品',
          description: '奶油色棉质短袖T恤，圆领，短袖到上臂，衣身修身。',
        },
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
    assert.match(prompt, /修身奶油色短袖T恤\(inner_top\)：奶油色棉质短袖T恤，圆领，短袖到上臂，衣身修身。/);
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
    assert.match(SEEDREAM_SYSTEM_INSTRUCTION, /没有参考图的单品以穿着描述为准/);
    // 参考图短标签不应把整段 description 硬塞进 48 字窗口后静默丢失语义来源
    assert.doesNotMatch(prompt, /图1Wide-Leg Trousers \| bottom \| BOTTOM/);
  });

  it('keeps ski-pants wording and accessory colors that sit past the old 320-char cut', () => {
    const ski: StylistOutfit = {
      ...outfit,
      selected_items: [
        { id: 'fleece', name: 'Fleece Pullover', layer: 'inner_top', reason: '中间层' },
        { id: 'new_item', name: 'Insulated Waterproof Ski Jacket', layer: 'outerwear', reason: '新品' },
        { id: 'new_item', name: 'Insulated Waterproof Ski Pants', layer: 'bottom', reason: '新品' },
        { id: 'new_item', name: 'Ski Boots', layer: 'shoes', reason: '新品' },
        { id: 'new_item', name: 'Ski Gloves, Beanie & Goggles', layer: 'accessory', reason: '新品' },
      ],
      visual_composition: {
        model_pose: 'A fashion model standing confidently on a snowy ski slope, holding ski poles, smiling warmly',
        outfit_details:
          'Wearing a dark brown oversized fleece pullover as a mid-layer, topped with a navy waterproof insulated ski jacket (hip-length, relaxed fit with snow skirt), paired with black insulated ski pants (high-waisted, straight-leg, adjustable waist), and black ski boots (mid-calf, buckled, chunky sole). Accessories include a gray ribbed knit beanie, black waterproof ski gloves, and clear anti-fog ski goggles.',
        background: 'A sunlit snowy ski resort with pine trees, ski lifts, and soft blue sky',
      },
    };
    const prompt = buildSeedreamImagePrompt(
      ski,
      undefined,
      ['Fleece Pullover | inner_top | A dark brown oversized fleece pullover'],
      null
    );
    assert.doesNotMatch(prompt, /snow skirt/i);
    assert.match(prompt, /防雪裙，属于外套下摆，不是半身裙/);
    assert.match(prompt, /gray ribbed knit beanie/);
    assert.match(prompt, /clear anti-fog ski goggles/);
    assert.match(prompt, /Ski Gloves, Beanie & Goggles\(accessory\)/);
    assert.match(prompt, /下装必须是长滑雪裤/);
    assert.match(prompt, /禁止用参考图的品类或颜色替代/);
  });

  it('专用款式写成禁令，斗篷和系带外层不强制敞开', () => {
    const hanfu: StylistOutfit = {
      ...outfit,
      selected_items: [
        {
          id: 'new_item',
          name: '杏色立领对襟短袄',
          layer: 'inner_top',
          reason: '内搭',
          description: '杏色棉，立领，对襟系带，直袖，衣长至腰下。',
        },
        {
          id: 'new_item',
          name: '浅驼色马面裙',
          layer: 'bottom',
          reason: '下装',
          description: '浅驼色毛呢，高腰，前后裙门，两侧褶，裙长至脚踝。',
        },
        {
          id: 'new_item',
          name: '浅灰蓝斗篷',
          layer: 'outerwear',
          reason: '外披',
          description: '浅灰蓝羊毛，无领，前开系带，无袖，长度至臀部。',
        },
      ],
      visual_composition: {
        model_pose: '站立',
        outfit_details: '无领斗篷披在短袄外，马面裙到脚踝。',
        background: '石板路',
      },
    };
    const prompt = buildSeedreamImagePrompt(hanfu, undefined, [], null);
    assert.match(prompt, /前后是平的裙门，褶只在两侧/);
    assert.match(prompt, /禁止画成开衩直筒裙/);
    assert.match(prompt, /禁止加帽子，禁止画成连帽长披风/);
    assert.doesNotMatch(prompt, /敞开或半敞/);

    const tied: StylistOutfit = {
      ...outfit,
      selected_items: [
        { id: 'new_item', name: '米白衬衫', layer: 'inner_top', reason: '内搭', description: '米白衬衫。' },
        {
          id: 'new_item',
          name: '浅驼盘扣外套',
          layer: 'outerwear',
          reason: '外套',
          description: '浅驼毛呢，盘扣门襟，衣长至髋。',
        },
      ],
      visual_composition: {
        model_pose: '站立',
        outfit_details: '盘扣外套配衬衫。',
        background: '街道',
      },
    };
    const tiedPrompt = buildSeedreamImagePrompt(tied, undefined, [], null);
    assert.doesNotMatch(tiedPrompt, /敞开或半敞/);

    const bijia = buildSeedreamImagePrompt(
      {
        ...outfit,
        selected_items: [
          { id: 'new_item', name: '豆沙粉短袄', layer: 'inner_top', reason: '内搭', description: '交领短袄。' },
          {
            id: 'new_item',
            name: '浅驼比甲',
            layer: 'outerwear',
            reason: '外层',
            description: '无袖对襟，衣长至膝盖上方。',
          },
        ],
        visual_composition: {
          model_pose: '站立',
          outfit_details: '比甲罩在短袄外。',
          background: '庭院',
        },
      },
      undefined,
      [],
      null
    );
    assert.match(bijia, /禁止画成拖到脚踝的长马甲/);
    assert.doesNotMatch(bijia, /敞开或半敞/);
    assert.match(SEEDREAM_SYSTEM_INSTRUCTION, /斗篷、比甲、系带和盘扣的外层按描述的门襟/);
  });
});
