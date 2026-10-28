import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterAnchorCandidatesByWeather } from '@/server/utils/ragSeasonFilter';

describe('filterAnchorCandidatesByWeather', () => {
  const sleeveless = {
    id: 'dress-summer',
    tempMin: 22,
    tempMax: null as number | null,
    similarity: 0.61,
  };
  const knitDress = {
    id: 'dress-mild',
    tempMin: 12,
    tempMax: 22 as number | null,
    similarity: 0.55,
  };

  it('drops tempMin=22 dress at 17℃', () => {
    const filtered = filterAnchorCandidatesByWeather(
      [sleeveless, knitDress],
      '重庆城区，阴，17℃'
    );
    assert.deepEqual(
      filtered.map((item) => item.id),
      ['dress-mild']
    );
  });

  it('keeps all when weather has no parseable temperature', () => {
    const filtered = filterAnchorCandidatesByWeather([sleeveless], '');
    assert.equal(filtered.length, 1);
  });

  it('returns empty when every candidate is out of range', () => {
    const filtered = filterAnchorCandidatesByWeather([sleeveless], '阴天约17℃');
    assert.equal(filtered.length, 0);
  });
});
