import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalSuitedStyle } from '@/server/agents/stylist/skillSelection';
import {
  mergeChatProfileForPersistence,
  mergeVisualAnalysisIntoProfile,
} from '@/server/utils/profileMetadata';
import type { UserProfileResult } from '@/server/agents/user-profile';

const chatResult = {
  name: '',
  height: '',
  weight: '',
  preferences: [],
  skin_tone: '',
  body_shape: '',
  personal_style: '日常休闲',
  visual_features: { hair_color: 'unknown', detected_features: 'none' },
} satisfies UserProfileResult;

describe('canonicalSuitedStyle', () => {
  it('keeps one known style word and drops everything else', () => {
    assert.equal(canonicalSuitedStyle('适合韩系，肩比较窄'), '韩系');
    assert.equal(canonicalSuitedStyle('适合汉服'), '汉服');
    assert.equal(canonicalSuitedStyle('国风'), '新中式');
    assert.equal(canonicalSuitedStyle('古风'), '新中式');
    assert.equal(canonicalSuitedStyle('休闲风'), '');
    assert.equal(canonicalSuitedStyle('日常休闲'), '');
    assert.equal(canonicalSuitedStyle(''), '');
  });
});

describe('mergeVisualAnalysisIntoProfile', () => {
  it('stores the judged style without treating the photo clothes as a style', () => {
    const merged = mergeVisualAnalysisIntoProfile(
      { personal_style: '日常休闲', preferences: ['常穿灰白'] },
      {
        skin_tone: '冷调',
        body_shape: '肩窄，比例偏长',
        suited_style: '更接近韩系，不是照片里的家居服',
        visual_features: { hair_color: '黑色', detected_features: '气质偏安静' },
      },
      'https://example.com/portrait.jpg'
    );
    assert.equal(merged.suited_style, '韩系');
    assert.equal(merged.personal_style, '日常休闲');
    assert.equal(merged.visual_profile_verified, true);
  });

  it('stores gender from the photo and keeps the old value when re-analysis is unsure', () => {
    const first = mergeVisualAnalysisIntoProfile(
      {},
      {
        gender: '男',
        skin_tone: '冷调',
        body_shape: '肩宽',
        visual_features: { hair_color: '黑色', detected_features: '短发' },
      },
      'https://example.com/portrait.jpg'
    );
    assert.equal(first.gender, '男');

    const second = mergeVisualAnalysisIntoProfile(first, {
      gender: '',
      skin_tone: '冷调',
      body_shape: '肩宽',
      visual_features: { hair_color: '黑色', detected_features: '短发' },
    }, 'https://example.com/portrait2.jpg');
    assert.equal(second.gender, '男');
  });
});

describe('mergeChatProfileForPersistence', () => {
  it('keeps the judged style when the chat profile agent does not write it', () => {
    const merged = mergeChatProfileForPersistence(chatResult, {
      visual_profile_verified: true,
      suited_style: '韩系',
    });
    assert.equal(merged.suited_style, '韩系');
    assert.equal(merged.personal_style, '日常休闲');
  });

  it('keeps photo gender when the chat profile agent does not write it', () => {
    const merged = mergeChatProfileForPersistence(chatResult, {
      visual_profile_verified: true,
      gender: '男',
    });
    assert.equal(merged.gender, '男');
  });
});
