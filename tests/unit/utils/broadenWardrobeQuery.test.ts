import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { broadenWardrobeQuery } from '@/server/utils/broadenWardrobeQuery';

describe('broadenWardrobeQuery', () => {
  it('strips specific colors and craft from a fine query', () => {
    const coarse = broadenWardrobeQuery('灰粉色圆领绞花针织毛衣');
    assert.match(coarse, /针织|毛衣/);
    assert.doesNotMatch(coarse, /灰粉|圆领|绞花/);
  });

  it('keeps silhouette cues like 高腰 A字 半身裙', () => {
    const coarse = broadenWardrobeQuery('藏蓝色高腰A字半身裙');
    assert.match(coarse, /高腰|A字|半身裙/);
    assert.doesNotMatch(coarse, /藏蓝/);
  });

  it('returns original when already coarse', () => {
    assert.equal(broadenWardrobeQuery('高腰直筒裤'), '高腰直筒裤');
    assert.equal(broadenWardrobeQuery('针织毛衣'), '针织毛衣');
  });

  it('handles empty input', () => {
    assert.equal(broadenWardrobeQuery(''), '');
    assert.equal(broadenWardrobeQuery('   '), '');
  });
});
