import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mergeChatProfileForPersistence,
  mergeLocationIntoProfileData,
} from '@/server/utils/profileMetadata';
import type { UserProfileResult } from '@/server/agents/user-profile';

describe('mergeLocationIntoProfileData', () => {
  it('writes city when location empty', () => {
    const { next, changed } = mergeLocationIntoProfileData(
      { preferences: ['常穿灰白色系'] },
      '重庆'
    );
    assert.equal(changed, true);
    assert.equal(next.location, '重庆');
    assert.deepEqual(next.preferences, ['常穿灰白色系']);
  });

  it('no-ops on empty city or same location', () => {
    assert.equal(mergeLocationIntoProfileData({ location: '重庆' }, '').changed, false);
    assert.equal(mergeLocationIntoProfileData({ location: '重庆' }, ' 重庆 ').changed, false);
  });

  it('updates when city changes', () => {
    const { next, changed } = mergeLocationIntoProfileData({ location: '上海' }, '重庆');
    assert.equal(changed, true);
    assert.equal(next.location, '重庆');
  });
});

describe('mergeChatProfileForPersistence preserves location', () => {
  it('keeps location metadata when chat agent has no location field', () => {
    const result = {
      name: '',
      height: '',
      weight: '',
      preferences: ['常穿灰白色系'],
      skin_tone: '',
      body_shape: '',
      personal_style: '日常休闲',
      visual_features: { hair_color: 'unknown', detected_features: 'none' },
    } satisfies UserProfileResult;

    const merged = mergeChatProfileForPersistence(result, { location: '重庆' });
    assert.equal(merged.location, '重庆');
  });
});

describe('profile location persist gate (city_role)', () => {
  it('only home role should be eligible for profile write', () => {
    const shouldPersist = (city?: string, city_role?: string) =>
      Boolean(city?.trim() && city_role === 'home');

    assert.equal(shouldPersist('重庆', 'home'), true);
    assert.equal(shouldPersist('三亚', 'travel'), false);
    assert.equal(shouldPersist('重庆', ''), false);
    assert.equal(shouldPersist('', 'home'), false);
  });
});
