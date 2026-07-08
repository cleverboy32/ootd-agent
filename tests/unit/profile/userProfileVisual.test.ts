import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyVerifiedVisualFields, readVerifiedVisualProfile } from '@/server/utils/userProfileVisual';

const baseResult = {
  name: '',
  height: '156cm',
  weight: '48kg',
  preferences: [],
  personal_style: '日常休闲',
  skin_tone: '暖色调',
  body_shape: '矩形型',
  visual_features: { hair_color: 'dark brown', detected_features: '戴眼镜' },
};

describe('readVerifiedVisualProfile', () => {
  it('returns empty visual when not verified', () => {
    const visual = readVerifiedVisualProfile({
      skin_tone: '暖色调',
      body_shape: '矩形型',
      visual_features: { hair_color: 'dark brown', detected_features: '戴眼镜' },
    });
    assert.equal(visual.skin_tone, '');
    assert.equal(visual.visual_features.hair_color, 'unknown');
  });

  it('keeps visual when verified', () => {
    const visual = readVerifiedVisualProfile({
      visual_profile_verified: true,
      skin_tone: '暖色调',
      body_shape: '矩形型',
      visual_features: { hair_color: 'dark brown', detected_features: '戴眼镜' },
    });
    assert.equal(visual.skin_tone, '暖色调');
  });
});

describe('applyVerifiedVisualFields', () => {
  it('strips model-hallucinated visual fields when unverified', () => {
    const result = applyVerifiedVisualFields(baseResult, {});
    assert.equal(result.skin_tone, '');
    assert.equal(result.body_shape, '');
    assert.equal(result.visual_features.detected_features, 'none');
  });
});
