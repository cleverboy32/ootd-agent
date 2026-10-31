/**
 * Stylist 选 skill Prompt 回归
 *
 * 调真实 LLM，验证判断原则是否生效。
 * 运行：pnpm exec dotenv -e .env -e .env.local -- tsx --test tests/prompts/stylistSkills.prompt.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeGatekeeperIntent } from '@/server/agents/intent';
import { selectStylistSkills } from '@/server/agents/stylist/selectSkills';
import {
  STYLIST_SELECTABLE_SKILL_NAMES,
  normalizeStylistSkillNames,
} from '@/server/agents/stylist/skillSelection';
import type { UserProfileResult } from '@/server/agents/user-profile/schema';

const SELECTABLE = new Set<string>(STYLIST_SELECTABLE_SKILL_NAMES);

const PROFILE: UserProfileResult = {
  name: '',
  height: '165cm',
  weight: '',
  preferences: [],
  skin_tone: '',
  body_shape: '',
  personal_style: '日常休闲',
  suited_style: '',
  visual_features: { hair_color: '', detected_features: '' },
};

function assertWhitelistOnly(names: string[]): void {
  const normalized = normalizeStylistSkillNames(names);
  assert.deepEqual(names, normalized, `应已是净化后的白名单: ${names.join(',')}`);
  for (const name of names) {
    assert.ok(SELECTABLE.has(name), `非白名单: ${name}`);
  }
}

describe('Stylist — select skills', () => {
  it('跳古典舞且无汉服点名 → 不含 style-history', async () => {
    const intent = normalizeGatekeeperIntent({
      request_type: 'wardrobe_outfit',
      occasion: '跳古典舞',
      style_preference: '日常休闲',
      special_requests: '明天去跳古典舞，需要方便活动',
      weather: '重庆城区，阴，17℃',
    });
    const names = await selectStylistSkills(intent, '明天要去跳古典舞，我穿什么呢', PROFILE);
    assertWhitelistOnly(names);
    assert.ok(!names.includes('style-history'), `不应含汉服 skill: ${names.join(',')}`);
  });

  it('点名汉服 → 含 style-history', async () => {
    const intent = normalizeGatekeeperIntent({
      request_type: 'wardrobe_outfit',
      occasion: '日常出门',
      style_preference: '',
      special_requests: '想穿汉服出门',
    });
    const names = await selectStylistSkills(intent, '我想穿汉服出门，帮我搭', PROFILE);
    assertWhitelistOnly(names);
    assert.ok(names.includes('style-history'), `应含汉服 skill: ${names.join(',')}`);
  });

  it('只说国风 → 挂 style-new-chinese，不含 style-history', async () => {
    const intent = normalizeGatekeeperIntent({
      request_type: 'wardrobe_outfit',
      occasion: '日常出门',
      style_preference: '国风',
      special_requests: '想穿国风一点',
    });
    const names = await selectStylistSkills(intent, '帮我搭一套国风的', PROFILE);
    assertWhitelistOnly(names);
    assert.ok(names.includes('style-new-chinese'), `国风应导流新中式: ${names.join(',')}`);
    assert.ok(!names.includes('style-history'), `国风不应挂汉服 skill: ${names.join(',')}`);
  });

  it('有今日天气的出门请求 → 含 weather-dressing', async () => {
    const intent = normalizeGatekeeperIntent({
      request_type: 'wardrobe_outfit',
      occasion: '日常出门',
      weather: '上海市，多云，22℃，东风≤3级，湿度60%',
      style_preference: '',
    });
    const names = await selectStylistSkills(intent, '今天出门穿什么', PROFILE);
    assertWhitelistOnly(names);
    assert.ok(names.includes('weather-dressing'), `应含天气技能: ${names.join(',')}`);
  });
});
