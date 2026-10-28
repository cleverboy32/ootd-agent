import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  outfitsHaveSameItemFingerprints,
} from '@/server/utils/stylistRevisionCompare';
import type { StylistOutfit } from '@/server/agents/stylist';

const baseVisual = {
  model_pose: '站立',
  outfit_details: '细节',
  background: '室内',
};

describe('outfitsHaveSameItemFingerprints', () => {
  it('new_item 只改名算有变化', () => {
    const prev: StylistOutfit = {
      id: 'outfit_1',
      overall_concept: 'a',
      selected_items: [
        {
          id: 'new_item',
          name: '米色芭蕾平底鞋',
          layer: 'shoes',
          reason: 'r',
          description: '浅口软底',
        },
      ],
      visual_composition: baseVisual,
    };
    const next: StylistOutfit = {
      ...prev,
      selected_items: [
        {
          id: 'new_item',
          name: '软底交叉带古典舞鞋',
          layer: 'shoes',
          reason: 'r',
          description: '交叉松紧带薄底',
        },
      ],
    };
    assert.equal(outfitsHaveSameItemFingerprints(prev, next), false);
  });

  it('衣橱同 id 算未变', () => {
    const prev: StylistOutfit = {
      id: 'outfit_1',
      overall_concept: 'a',
      selected_items: [
        { id: 'acc1', name: '耳环', layer: 'accessory', reason: 'r', description: '' },
      ],
      visual_composition: baseVisual,
    };
    const next: StylistOutfit = {
      ...prev,
      selected_items: [
        { id: 'acc1', name: '耳环改名', layer: 'accessory', reason: 'r2', description: '' },
      ],
    };
    assert.equal(outfitsHaveSameItemFingerprints(prev, next), true);
  });
});
