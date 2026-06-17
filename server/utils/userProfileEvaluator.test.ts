import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UserProfileResult } from '@/app/api/generate-with-image/handlers/userProfileAgent';
import { evaluateUserProfileOutput } from './userProfileEvaluator';

const baseProfile: UserProfileResult = {
  name: '',
  height: '',
  weight: '',
  preferences: [],
  skin_tone: '',
  body_shape: '',
  personal_style: '日常休闲',
  visual_features: { hair_color: 'unknown', detected_features: 'none' },
};

describe('evaluateUserProfileOutput', () => {
  it('passes when profile merges cleanly with no previous data', () => {
    const result = evaluateUserProfileOutput({
      previousProfile: {},
      result: { ...baseProfile, preferences: ['喜欢休闲'] },
      contextText: '我喜欢休闲风格',
    });
    assert.equal(result.passed, true);
    assert.equal(result.score, 100);
  });

  it('warns when height is lost without context mention', () => {
    const result = evaluateUserProfileOutput({
      previousProfile: { height: '168cm' },
      result: { ...baseProfile, height: '' },
      contextText: '明天去海边拍照',
    });
    assert.equal(result.passed, true);
    assert.ok(result.issues.some((i) => i.code === 'DATA_LOSS_HEIGHT'));
    assert.equal(result.stats.fieldsPreserved.height, false);
  });

  it('preserves height when user mentions new value in context', () => {
    const result = evaluateUserProfileOutput({
      previousProfile: { height: '168cm' },
      result: { ...baseProfile, height: '165cm' },
      contextText: '我身高现在165cm了',
    });
    assert.ok(!result.issues.some((i) => i.code === 'DATA_LOSS_HEIGHT'));
  });

  it('warns when model inferred visual fields that were stripped', () => {
    const rawParsed: UserProfileResult = {
      ...baseProfile,
      skin_tone: '暖色调',
      body_shape: '矩形型',
      visual_features: { hair_color: 'dark brown', detected_features: '戴眼镜' },
    };
    const result = evaluateUserProfileOutput({
      previousProfile: {},
      result: baseProfile,
      rawParsed,
      contextText: '帮我搭配',
    });
    assert.ok(result.issues.some((i) => i.code === 'VISUAL_INFERENCE_BLOCKED'));
    assert.equal(result.stats.visualInferenceBlocked, true);
  });

  it('warns when name set without explicit introduction', () => {
    const result = evaluateUserProfileOutput({
      previousProfile: {},
      result: { ...baseProfile, name: '大哥' },
      rawParsed: { ...baseProfile, name: '大哥' },
      contextText: '大哥，是灰色外套',
      currentMessageText: '大哥，是灰色外套',
    });
    assert.ok(result.issues.some((i) => i.code === 'NAME_WITHOUT_EXPLICIT_INTRO'));
  });

  it('fails when personal_style is empty', () => {
    const result = evaluateUserProfileOutput({
      previousProfile: {},
      result: { ...baseProfile, personal_style: '' },
    });
    assert.equal(result.passed, false);
    assert.ok(result.issues.some((i) => i.code === 'MISSING_PERSONAL_STYLE'));
  });

  it('warns when preferences are entirely cleared', () => {
    const result = evaluateUserProfileOutput({
      previousProfile: { preferences: ['周末徒步', '日常通勤'] },
      result: baseProfile,
      contextText: '去海边拍照',
    });
    assert.ok(result.issues.some((i) => i.code === 'DATA_LOSS_PREFERENCES'));
  });
});
