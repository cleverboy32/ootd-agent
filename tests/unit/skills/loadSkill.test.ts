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
  });
});
