import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeGatekeeperIntent } from '@/server/agents/intent';
import { STYLIST_SYSTEM_INSTRUCTION } from '@/server/agents/stylist/prompts';
import {
  selectStylistOutfitSkillNames,
  selectStylistSkillNames,
} from '@/server/agents/stylist/skillSelection';
import { buildSkillBlocks, loadSkill } from '@/server/skills/loadSkill';

describe('loadSkill', () => {
  it('weather-dressing：返回正文且去掉 frontmatter', () => {
    const body = loadSkill('weather-dressing');
    assert.ok(body.length > 0);
    assert.doesNotMatch(body, /^---/);
    assert.doesNotMatch(body, /^name:/m);
    assert.doesNotMatch(body, /^description:/m);
  });

  it('weather-dressing：包含温度档位与修正项两节', () => {
    const body = loadSkill('weather-dressing');
    assert.match(body, /## 温度档位/);
    assert.match(body, /## 修正项/);
  });

  it('不存在的 skill 抛出含名称的错误', () => {
    assert.throws(() => loadSkill('no-such-skill'), /no-such-skill/);
  });

  it('二次调用返回同一缓存结果', () => {
    assert.equal(loadSkill('weather-dressing'), loadSkill('weather-dressing'));
  });

  it('athletic-outfit：返回正文且去掉 frontmatter', () => {
    const body = loadSkill('athletic-outfit');
    assert.ok(body.length > 0);
    assert.doesNotMatch(body, /^---/);
    assert.doesNotMatch(body, /^name:/m);
    assert.match(body, /Wrap Shorts/);
    assert.match(body, /athletic \/ sports \/ breathable \/ training/);
    assert.match(body, /sports shorts/);
  });
});

describe('selectStylistSkillNames', () => {
  function block(intent: Parameters<typeof normalizeGatekeeperIntent>[0], userMessage = '') {
    const names = selectStylistSkillNames(normalizeGatekeeperIntent(intent), userMessage);
    return buildSkillBlocks(names);
  }

  it('有天气且非运动 → 只有 weather-dressing', () => {
    const text = block({
      request_type: 'wardrobe_outfit',
      occasion: '日常通勤',
      weather: '上海市，多云，25℃',
    });
    assert.match(text, /【技能 weather-dressing】/);
    assert.doesNotMatch(text, /athletic-outfit/);
  });

  it('篮球或健身 → 含 athletic-outfit', () => {
    const basketball = block({
      request_type: 'wardrobe_outfit',
      occasion: '篮球',
    });
    assert.match(basketball, /【技能 athletic-outfit】/);
    assert.match(basketball, /功能性优先/);

    const gym = block(
      { request_type: 'wardrobe_outfit', occasion: '周末' },
      '晚上去健身'
    );
    assert.match(gym, /【技能 athletic-outfit】/);
  });

  it('天气和运动同时命中时两份都注入', () => {
    const text = block(
      {
        request_type: 'wardrobe_outfit',
        occasion: '户外',
        weather: '北京市，晴，18℃',
      },
      '下午去跑步'
    );
    assert.match(text, /【技能 weather-dressing】/);
    assert.match(text, /【技能 athletic-outfit】/);
  });

  it('两者都没有 → 空字符串', () => {
    assert.equal(
      block({ request_type: 'wardrobe_outfit', occasion: '日常通勤' }),
      ''
    );
  });

  it('买新品时注入造型规则，并按用户说法注入一个风格', () => {
    const hanfu = block(
      {
        request_type: 'wardrobe_outfit',
        special_requests: '想买一件汉服',
      },
      '想买一件汉服'
    );
    assert.match(hanfu, /【技能 outfit-design】/);
    assert.match(hanfu, /【技能 style-guofeng】/);
    assert.match(hanfu, /马面裙必须写前后裙门和两侧褶/);
    assert.doesNotMatch(hanfu, /style-new-chinese/);

    const cool = block(
      { request_type: 'wardrobe_outfit', style_preference: '潮酷' },
      '想看新品'
    );
    assert.match(cool, /【技能 style-cool】/);
    assert.match(cool, /一个夸张比例/);
    assert.doesNotMatch(cool, /style-sweet/);
  });

  it('风格词只注入一个，甜酷归潮酷，新中式不归古风', () => {
    const sweetCool = block({ request_type: 'wardrobe_outfit' }, '甜酷一点');
    assert.match(sweetCool, /【技能 style-cool】/);
    assert.doesNotMatch(sweetCool, /style-sweet|outfit-design/);

    const modern = block(
      { request_type: 'wardrobe_outfit', style_preference: '新中式' },
      '新中式古风'
    );
    assert.match(modern, /【技能 style-new-chinese】/);
    assert.doesNotMatch(modern, /style-guofeng/);

    const styles: Array<[string, string]> = [
      ['老钱风', 'style-old-money'],
      ['甜美约会', 'style-sweet'],
      ['法式', 'style-french'],
      ['韩系', 'style-korean'],
      ['极简', 'style-minimal'],
      ['文艺一点', 'style-literary'],
      ['职场通勤', 'style-commute'],
    ];
    for (const [message, skill] of styles) {
      const text = block({ request_type: 'wardrobe_outfit' }, message);
      assert.match(text, new RegExp(`【技能 ${skill}】`), message);
    }
  });

  it('没点名风格时用照片判断的适合风格，这轮原话和日常休闲占位都不让路', () => {
    const judged = buildSkillBlocks(
      selectStylistSkillNames(
        normalizeGatekeeperIntent({ request_type: 'wardrobe_outfit', style_preference: '日常休闲' }),
        '今天怎么穿',
        { personal_style: '日常休闲', suited_style: '韩系' }
      )
    );
    assert.match(judged, /【技能 style-korean】/);

    const named = buildSkillBlocks(
      selectStylistSkillNames(
        normalizeGatekeeperIntent({ request_type: 'wardrobe_outfit' }),
        '想买一件汉服',
        { personal_style: '日常休闲', suited_style: '韩系' }
      )
    );
    assert.match(named, /【技能 style-guofeng】/);
    assert.doesNotMatch(named, /style-korean/);

    const stated = buildSkillBlocks(
      selectStylistSkillNames(
        normalizeGatekeeperIntent({ request_type: 'wardrobe_outfit', style_preference: '日常休闲' }),
        '帮我搭一套',
        { personal_style: '老钱', suited_style: '韩系' }
      )
    );
    assert.match(stated, /【技能 style-old-money】/);
    assert.doesNotMatch(stated, /style-korean/);
  });

  it('场合里的日常通勤不注入通勤技能', () => {
    const text = block({
      request_type: 'wardrobe_outfit',
      occasion: '日常通勤',
      style_preference: '简约',
    });
    assert.equal(text, '');
  });

  it('身材技能按档案和原话注入，剪裁限制可以叠加', () => {
    const pear = buildSkillBlocks(
      selectStylistSkillNames(
        normalizeGatekeeperIntent({ request_type: 'wardrobe_outfit' }),
        '帮我搭一套',
        { body_shape: '梨形，肩窄胯宽', height: '158cm' }
      )
    );
    assert.match(pear, /【技能 body-pear】/);
    assert.match(pear, /【技能 body-petite】/);
    assert.match(pear, /上衣的下摆停在胯最宽的地方/);
    assert.doesNotMatch(pear, /body-apple/);

    const shoulder = buildSkillBlocks(
      selectStylistSkillNames(
        normalizeGatekeeperIntent({ request_type: 'wardrobe_outfit', special_requests: '宽肩，五五分' }),
        '',
        { height: '168cm' }
      )
    );
    assert.match(shoulder, /【技能 body-broad-shoulder】/);
    assert.match(shoulder, /【技能 body-even】/);
    assert.doesNotMatch(shoulder, /body-petite/);
  });

  it('色彩技能按肤色注入，说冷不加冷皮', () => {
    const warm = buildSkillBlocks(
      selectStylistSkillNames(
        normalizeGatekeeperIntent({ request_type: 'wardrobe_outfit' }),
        '帮我搭一套',
        { skin_tone: '暖调' }
      )
    );
    assert.match(warm, /【技能 color-aesthetics】/);
    assert.match(warm, /【技能 color-warm】/);
    assert.match(warm, /不要全身米杏浅驼/);
    assert.doesNotMatch(warm, /color-cool/);

    const coldWeather = buildSkillBlocks(
      selectStylistSkillNames(
        normalizeGatekeeperIntent({
          request_type: 'wardrobe_outfit',
          special_requests: '外套有点冷，换个外套',
        }),
        '第二套外套有点冷'
      )
    );
    assert.doesNotMatch(coldWeather, /color-cool|color-aesthetics/);

    const contrast = buildSkillBlocks(
      selectStylistSkillNames(
        normalizeGatekeeperIntent({ request_type: 'wardrobe_outfit' }),
        '想要撞色'
      )
    );
    assert.match(contrast, /【技能 color-aesthetics】/);
    assert.doesNotMatch(contrast, /color-warm|color-cool|color-neutral/);
  });

  it('未知技能名抛出含名称的错误', () => {
    assert.throws(() => buildSkillBlocks(['no-such-skill']), /no-such-skill/);
  });
});

describe('selectStylistOutfitSkillNames', () => {
  function block(requestType: 'purchase_pairing' | 'wardrobe_pairing' | 'feedback_revision' | 'wardrobe_outfit') {
    return buildSkillBlocks(
      selectStylistOutfitSkillNames(normalizeGatekeeperIntent({ request_type: requestType }))
    );
  }

  it('三种搭配模式各只注入对应技能', () => {
    const purchase = block('purchase_pairing');
    assert.match(purchase, /【技能 stylist-purchase-pairing】/);
    assert.doesNotMatch(purchase, /wardrobe-pairing|feedback-revision/);

    const wardrobe = block('wardrobe_pairing');
    assert.match(wardrobe, /【技能 stylist-wardrobe-pairing】/);
    assert.match(wardrobe, /衣橱锚定搭配模式/);
    assert.doesNotMatch(wardrobe, /purchase-pairing|feedback-revision/);

    const revision = block('feedback_revision');
    assert.match(revision, /【技能 stylist-feedback-revision】/);
    assert.match(revision, /多轮对话与反馈微调模式/);
    assert.doesNotMatch(revision, /purchase-pairing|wardrobe-pairing/);
  });

  it('wardrobe_outfit 不注入搭配模式', () => {
    assert.equal(block('wardrobe_outfit'), '');
  });

  it('主提示词不再包含三种模式标题', () => {
    assert.doesNotMatch(STYLIST_SYSTEM_INSTRUCTION, /待购单品搭配模式/);
    assert.doesNotMatch(STYLIST_SYSTEM_INSTRUCTION, /衣橱锚定搭配模式/);
    assert.doesNotMatch(STYLIST_SYSTEM_INSTRUCTION, /反馈微调模式 feedback_revision/);
    assert.doesNotMatch(STYLIST_SYSTEM_INSTRUCTION, /多轮对话与反馈微调模式/);
    assert.match(STYLIST_SYSTEM_INSTRUCTION, /新品的 description 必填一句外观/);
    assert.match(STYLIST_SYSTEM_INSTRUCTION, /整套都用 new_item/);
    assert.match(STYLIST_SYSTEM_INSTRUCTION, /有色彩技能时，脸周颜色、深浅和面积按技能/);
    assert.doesNotMatch(STYLIST_SYSTEM_INSTRUCTION, /其余槽位用衣橱/);
    assert.doesNotMatch(STYLIST_SYSTEM_INSTRUCTION, /衣橱里已有该季节的外套就用衣橱/);
  });
});
