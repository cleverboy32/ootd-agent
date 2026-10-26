import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clampStylistOutfits } from '@/server/agents/stylist/schema';

describe('clampStylistOutfits', () => {
  it('keeps at most four outfits and preserves valid ids', () => {
    const outfits = clampStylistOutfits([
      { id: 'outfit_1' },
      { id: 'outfit_2' },
      { id: 'outfit_3' },
      { id: 'outfit_4' },
      { id: 'outfit_5' },
    ]);

    assert.deepEqual(
      outfits.map((outfit) => outfit.id),
      ['outfit_1', 'outfit_2', 'outfit_3', 'outfit_4']
    );
  });

  it('renumbers an id outside outfit_1 to outfit_4', () => {
    const outfits = clampStylistOutfits([
      { id: 'outfit_2' },
      { id: 'outfit_2' },
      { id: 'look_9' },
    ]);

    assert.deepEqual(
      outfits.map((outfit) => outfit.id),
      ['outfit_2', 'outfit_1', 'outfit_3']
    );
  });
});
