import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildOutfitPlanStrategyHint,
  buildReconcileNoStyleStrategyHint,
} from '@/server/agents/stylist/strategyHint';

describe('buildOutfitPlanStrategyHint', () => {
  it('无风格 outfit：要求槽位大类+厚薄，禁止细品类初稿', () => {
    const hint = buildOutfitPlanStrategyHint({ mode: 'outfit', hasStyleSkill: false });
    assert.match(hint, /无风格技能/);
    assert.match(hint, /槽位大类/);
    assert.match(hint, /禁止预设具体鞋型/);
    assert.doesNotMatch(hint, /形态细节放 target/);
  });

  it('有风格 outfit：形态进 target，query 粗品类+轮廓', () => {
    const hint = buildOutfitPlanStrategyHint({ mode: 'outfit', hasStyleSkill: true });
    assert.match(hint, /已注入风格技能/);
    assert.match(hint, /形态细节放 target/);
    assert.doesNotMatch(hint, /不定细品类初稿/);
  });

  it('pairing 无风格也强调大类+厚薄', () => {
    const hint = buildOutfitPlanStrategyHint({ mode: 'pairing', hasStyleSkill: false });
    assert.match(hint, /无风格技能/);
    assert.match(hint, /槽位大类/);
  });
});

describe('buildReconcileNoStyleStrategyHint', () => {
  it('无风格时注入衣橱组搭约束', () => {
    const block = buildReconcileNoStyleStrategyHint(false);
    assert.match(block, /无风格技能/);
    assert.match(block, /必须】用衣橱件/);
    assert.match(block, /status=none/);
  });

  it('有风格时不注入', () => {
    assert.equal(buildReconcileNoStyleStrategyHint(true), '');
  });
});
