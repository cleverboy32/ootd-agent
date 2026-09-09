import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mergeProfileUpdatePatch,
  normalizeProfileUpdate,
  profileUpdatePatchHasContent,
  shouldApplyGateProfileUpdate,
} from '@/server/utils/profileUpdatePatch';
import type { GatekeeperIntent } from '@/server/agents/intent';
import { DEFAULT_GATEKEEPER_INTENT } from '@/server/agents/intent';

function intent(partial: Partial<GatekeeperIntent>): GatekeeperIntent {
  return { ...DEFAULT_GATEKEEPER_INTENT, ...partial };
}

describe('normalizeProfileUpdate', () => {
  it('fills empty defaults for missing raw', () => {
    const update = normalizeProfileUpdate(undefined);
    assert.equal(update.needed, false);
    assert.deepEqual(update.patch.preference_additions, []);
  });

  it('trims patch fields', () => {
    const update = normalizeProfileUpdate({
      needed: true,
      patch: {
        name: ' 小明 ',
        height: '178',
        weight: '',
        personal_style: '简约',
        preference_additions: [' 喜欢休闲 ', '', 1],
      },
    });
    assert.equal(update.patch.name, '小明');
    assert.deepEqual(update.patch.preference_additions, ['喜欢休闲']);
  });
});

describe('mergeProfileUpdatePatch', () => {
  it('merges scalars and appends unique preferences', () => {
    const { next, changed } = mergeProfileUpdatePatch(
      {
        name: '',
        preferences: ['喜欢简约'],
        location: '杭州',
        visual_profile_verified: true,
      },
      {
        name: '小明',
        height: '178cm',
        weight: '',
        personal_style: '日常休闲',
        preference_additions: ['喜欢简约', '不爱穿外套'],
      }
    );

    assert.equal(changed, true);
    assert.equal(next.name, '小明');
    assert.equal(next.height, '178cm');
    assert.deepEqual(next.preferences, ['喜欢简约', '不爱穿外套']);
    assert.equal(next.location, '杭州');
    assert.equal(next.visual_profile_verified, true);
  });

  it('no-ops when patch empty relative to existing', () => {
    const { changed } = mergeProfileUpdatePatch(
      { name: '小明', preferences: ['喜欢简约'] },
      {
        name: '小明',
        height: '',
        weight: '',
        personal_style: '',
        preference_additions: ['喜欢简约'],
      }
    );
    assert.equal(changed, false);
  });
});

describe('shouldApplyGateProfileUpdate', () => {
  it('applies when needed with content on outfit request', () => {
    assert.equal(
      shouldApplyGateProfileUpdate(
        intent({ request_type: 'wardrobe_outfit' }),
        {
          needed: true,
          patch: {
            name: '小明',
            height: '',
            weight: '',
            personal_style: '',
            preference_additions: [],
          },
        },
        '我叫小明，今天穿什么'
      ),
      true
    );
  });

  it('blocks selection / revision even if needed', () => {
    assert.equal(
      shouldApplyGateProfileUpdate(
        intent({ request_type: 'outfit_selection' }),
        {
          needed: true,
          patch: {
            name: '小明',
            height: '',
            weight: '',
            personal_style: '',
            preference_additions: [],
          },
        },
        '我选第一套'
      ),
      false
    );
  });

  it('requires non-empty patch', () => {
    assert.equal(profileUpdatePatchHasContent({
      name: '',
      height: '',
      weight: '',
      personal_style: '',
      preference_additions: [],
    }), false);
    assert.equal(
      shouldApplyGateProfileUpdate(
        intent({ request_type: 'wardrobe_outfit' }),
        {
          needed: true,
          patch: {
            name: '',
            height: '',
            weight: '',
            personal_style: '',
            preference_additions: [],
          },
        },
        '今天穿什么'
      ),
      false
    );
  });
});
