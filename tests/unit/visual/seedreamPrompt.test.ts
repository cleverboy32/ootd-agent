import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  ACCESSORY_FULLBODY_FRAMING,
  buildModelSubjectDescription,
  buildSeedreamImagePrompt,
  isAccessoryReferenceLabel,
  PERSON_REFERENCE_LABEL,
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
    assert.match(prompt, /图1只取脸和身材，不取这张照片里的衣服/);
    assert.match(prompt, /图2Mini Dress原样穿上，不改裤型、袖型、领和长短/);
    assert.doesNotMatch(prompt, /斜向|五官、脸型|禁止拉腿|脸是图1本人/);
    assert.doesNotMatch(prompt, /中国年轻女性/);
    assert.doesNotMatch(prompt, /穿齐图1/);
    assert.ok(prompt.length <= 300);
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
    assert.match(prompt, /图1Mini Dress原样穿上/);
    assert.match(prompt, /中国年轻女性/);
    assert.doesNotMatch(prompt, /Fashion editorial/i);
    assert.doesNotMatch(prompt, /85mm/);
    assert.doesNotMatch(prompt, /mint mini dress/);
    assert.ok(prompt.length <= 300);
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
    assert.match(prompt, /图1Mini Dress原样穿上/);
    assert.match(prompt, /没有照片的单品：Choker/);
    assert.match(prompt, /项链极细贴锁骨/);
    assert.doesNotMatch(prompt, /禁止添加耳环|禁止添加项链|禁止添加手链|禁止添加戒指/);
    assert.ok(prompt.includes(ACCESSORY_FULLBODY_FRAMING));
    assert.doesNotMatch(prompt, /1–2厘米|不要单独放大成画面主角/);
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
    assert.match(prompt, /图1黑色机车皮衣原样穿上/);
    assert.match(prompt, /没有照片的单品：修身奶油色短袖T恤，奶油色棉质短袖T恤，圆领，短袖到上臂，衣身修身。；格纹半裙/);
    assert.doesNotMatch(prompt, /整套穿着|leather jacket worn open|叠穿层次|敞开或半敞/);
  });

  it('does not treat a named second purchase photo as text-only', () => {
    const uploads: StylistOutfit = {
      ...outfit,
      selected_items: [
        { id: 'new_item', name: '浅粉白细条纹宽松长袖衬衫', layer: 'inner_top', reason: '上衣' },
        {
          id: 'new_item',
          name: '米白/浅米色解构阔腿长裤',
          layer: 'bottom',
          reason: '裤子',
          description: '米白解构阔腿裤，高腰，斜向分割线。',
        },
        { id: 'new_item', name: '深棕方头乐福鞋', layer: 'shoes', reason: '鞋' },
      ],
      visual_composition: {
        model_pose: 'standing',
        outfit_details: 'striped shirt with deconstructed wide-leg pants',
        background: 'grey wall',
      },
    };
    const prompt = buildSeedreamImagePrompt(
      uploads,
      undefined,
      [
        '人物参考（只取脸、发型、肤色和身体比例，禁止穿这张照片里的衣服）',
        '浅粉白细条纹宽松长袖衬衫 (inner_top) — purchase ref',
        '米白/浅米色解构阔腿长裤 (bottom) — purchase ref',
      ],
      null
    );
    assert.match(prompt, /图2浅粉白细条纹宽松长袖衬衫、图3米白\/浅米色解构阔腿长裤原样穿上/);
    assert.match(prompt, /没有照片的单品：深棕方头乐福鞋/);
    assert.doesNotMatch(prompt, /斜向分割线|striped shirt/);
    assert.doesNotMatch(prompt, /没有照片的单品[\s\S]*解构阔腿长裤/);
    assert.ok(prompt.length <= 300);
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
    assert.match(prompt, /图1Wide-Leg Trousers原样穿上/);
    assert.doesNotMatch(prompt, /衣橱单品原文|front pleats|pleated trousers/);
    assert.match(SEEDREAM_SYSTEM_INSTRUCTION, /没有参考图的单品以穿着描述为准/);
    assert.doesNotMatch(prompt, /图1Wide-Leg Trousers \| bottom \| BOTTOM/);
  });

  it('keeps ski-pants wording and accessory colors that sit past the old 320-char cut', () => {
    const ski: StylistOutfit = {
      ...outfit,
      selected_items: [
        { id: 'fleece', name: 'Fleece Pullover', layer: 'inner_top', reason: '中间层' },
        {
          id: 'new_item',
          name: 'Insulated Waterproof Ski Jacket',
          layer: 'outerwear',
          reason: '新品',
          description: 'navy hip-length ski jacket with a snow skirt at the hem',
        },
        {
          id: 'new_item',
          name: 'Insulated Waterproof Ski Pants',
          layer: 'bottom',
          reason: '新品',
          description: 'black high-waisted ski pants',
        },
        { id: 'new_item', name: 'Ski Boots', layer: 'shoes', reason: '新品' },
        {
          id: 'new_item',
          name: 'Ski Gloves, Beanie & Goggles',
          layer: 'accessory',
          reason: '新品',
          description: 'gray ribbed knit beanie, black ski gloves, and clear anti-fog ski goggles',
        },
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
    assert.match(prompt, /没有照片的单品：[\s\S]*Ski Gloves, Beanie & Goggles/);
    assert.match(prompt, /下装必须是长滑雪裤/);
    assert.doesNotMatch(prompt, /Fleece Pullover as a mid-layer/);
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

  it('短路径：服装原样穿上，配饰后置且按品类写细小精致约束', () => {
    const withAcc: StylistOutfit = {
      ...outfit,
      selected_items: [
        { id: 'item_top', name: '白衬衫', layer: 'top', reason: '上装' },
        { id: 'item_acc', name: '圆环耳环', layer: 'accessory', reason: '点缀' },
      ],
      visual_composition: {
        model_pose: '站立',
        outfit_details: '白衬衫配小耳环',
        background: '街道',
      },
    };
    const prompt = buildSeedreamImagePrompt(
      withAcc,
      undefined,
      ['白衬衫 | top', '圆环耳环 真人佩戴比例 | accessory | ACCESSORY'],
      null
    );
    const clothingIdx = prompt.indexOf('白衬衫原样穿上');
    const accessoryIdx = prompt.indexOf('只取款式颜色，细小精致点缀');
    assert.ok(clothingIdx >= 0, 'clothing wear line');
    assert.ok(accessoryIdx > clothingIdx, 'accessory line after clothing');
    assert.match(prompt, /图\d圆环耳环/);
    assert.doesNotMatch(prompt, /圆环耳环原样穿上/);
    assert.match(prompt, /耳环极小极细、紧贴耳垂/);
    assert.doesNotMatch(prompt, /禁止添加项链|禁止添加手链|禁止添加戒指/);
    assert.ok(prompt.includes(ACCESSORY_FULLBODY_FRAMING));
    assert.doesNotMatch(prompt, /1–2厘米|项链细链贴锁骨|不要单独放大成画面主角/);
  });

  it('短路径：无配饰图时文字补细小精致', () => {
    const withAcc: StylistOutfit = {
      ...outfit,
      selected_items: [
        { id: 'item_top', name: '白衬衫', layer: 'top', reason: '上装' },
        { id: 'item_acc', name: '圆环耳环', layer: 'accessory', reason: '点缀' },
      ],
      visual_composition: {
        model_pose: '站立',
        outfit_details: '白衬衫配金色圆环耳环',
        background: '街道',
      },
    };
    const prompt = buildSeedreamImagePrompt(
      withAcc,
      undefined,
      ['用户本人 | person', '白衬衫 | top'],
      null
    );
    assert.match(prompt, /没有照片的单品：[\s\S]*圆环耳环[\s\S]*细小精致贴耳/);
    assert.match(prompt, /禁止偏大圆环/);
    assert.doesNotMatch(prompt, /禁止添加项链|图\d圆环耳环|1–2厘米/);
  });

  it('长路径：紧凑编号 + 硬禁令，不再重复整套穿着', () => {
    const withAcc: StylistOutfit = {
      ...outfit,
      selected_items: [
        {
          id: 'new_item',
          name: '米白连衣裙',
          layer: 'dress',
          reason: '主单品',
          description: '米白及膝连衣裙。',
        },
        {
          id: 'new_item',
          name: '金色细链',
          layer: 'accessory',
          reason: '点缀',
          description: '细链贴锁骨。',
        },
      ],
      visual_composition: {
        model_pose: '站立',
        outfit_details: '米白连衣裙配金色细链',
        background: '咖啡馆',
      },
    };
    const prompt = buildSeedreamImagePrompt(withAcc, undefined, [], null);
    assert.match(prompt, /^真实街拍/);
    assert.match(prompt, /穿：\n1\. 米白及膝连衣裙/);
    assert.match(prompt, /2\. .*细链贴锁骨/);
    assert.match(prompt, /项链极细贴锁骨/);
    assert.doesNotMatch(prompt, /禁止添加耳环|禁止添加项链/);
    assert.match(prompt, /全身或膝上中景/);
    assert.doesNotMatch(prompt, /整套穿着|无参考图单品|穿搭构成|1–2厘米/);
    assert.doesNotMatch(prompt, /不要单独放大成画面主角/);
  });

  it('长路径：方领/及臀写成硬禁令，舞蹈场景加反芭蕾', () => {
    const dance: StylistOutfit = {
      id: 'outfit_1',
      overall_concept: '古典舞录制',
      selected_items: [
        {
          id: 'new_item',
          name: '浅驼色羊毛混纺针织开衫',
          layer: 'outerwear',
          reason: '外搭',
          description: '浅驼色羊毛混纺针织开衫，V 领单排扣，长袖，衣长及臀，罗纹下摆。',
        },
        {
          id: 'new_item',
          name: '奶白色方领长袖舞蹈上衣',
          layer: 'inner_top',
          reason: '内搭',
          description: '奶白色弹力针织方领上衣，长袖，贴身形，长度到腰。',
        },
        {
          id: 'new_item',
          name: '小巧金色耳钉',
          layer: 'accessory',
          reason: '点缀',
          description: '金色小圆点耳钉，直径约0.3cm，紧贴耳垂。',
        },
      ],
      visual_composition: {
        model_pose: '站立，微侧，一手提裙摆',
        outfit_details: '方领上衣配及臀开衫',
        background: '舞蹈教室，木质地板，背景有把杆',
      },
    };
    const prompt = buildSeedreamImagePrompt(
      dance,
      undefined,
      [PERSON_REFERENCE_LABEL],
      null
    );
    const full = `${SEEDREAM_SYSTEM_INSTRUCTION}\n${prompt}`;
    const line1 = prompt.split('\n').find((l) => l.startsWith('1. ')) ?? '';
    const line2 = prompt.split('\n').find((l) => l.startsWith('2. ')) ?? '';
    const line3 = prompt.split('\n').find((l) => l.startsWith('3. ')) ?? '';
    assert.match(line1, /衣长必须及臀，禁止短到腰/);
    assert.match(line1, /敞开穿，露出内搭/);
    assert.doesNotMatch(line1, /必须方领|禁止大圈耳环/);
    assert.match(line2, /必须方领，禁止圆领\/U领\/无袖/);
    assert.doesNotMatch(line2, /禁止大圈耳环|衣长必须及臀/);
    assert.match(line3, /禁止大圈耳环/);
    assert.doesNotMatch(line3, /必须方领|及臀/);
    assert.match(prompt, /不要画成芭蕾演出造型/);
    assert.doesNotMatch(prompt, /整套穿着|无参考图单品|五官、脸型|塑料皮肤/);
    assert.ok(full.length < 900, `full prompt too long: ${full.length}`);
  });
});

describe('isAccessoryReferenceLabel', () => {
  it('识别 layer / ACCESSORY / 品类词', () => {
    assert.equal(isAccessoryReferenceLabel('圆环耳环 真人佩戴比例 | accessory'), true);
    assert.equal(isAccessoryReferenceLabel('Pendant | ACCESSORY | silver'), true);
    assert.equal(isAccessoryReferenceLabel('白衬衫 | top'), false);
  });
});
