import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMainCategory,
  normalizeSeasonList,
  normalizeWardrobeAnalysis,
  WARDROBE_ANALYSIS_PROMPT,
} from '@/server/utils/wardrobeAnalysis';

describe('WARDROBE_ANALYSIS_PROMPT', () => {
  it('writes Chinese exterior text and keeps lining out of the main color', () => {
    assert.match(WARDROBE_ANALYSIS_PROMPT, /自由文本全部用中文/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /不要写成光滑衬衫/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /不要记成第二种颜色/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /不要写成镶边/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /款式名不决定温度/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /棉服看蓬松/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /不要写成轻薄、轻量或薄壳/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /薄针织和毛呢衬衫大约 12-22/);
  });

  it('maps Chinese season and formality onto the stored enums', () => {
    assert.deepEqual(normalizeSeasonList(['春', '秋季']), ['spring', 'autumn']);
    const normalized = normalizeWardrobeAnalysis({
      mainCategory: 'OUTERWEAR',
      subCategory: '棒球夹克',
      season: ['秋', '冬'],
      material: ['尼龙'],
      colors: ['炭灰'],
      tags: ['休闲'],
      description: '炭灰尼龙棒球夹克。',
      formality: '商务休闲',
    });
    assert.deepEqual(normalized?.season, ['autumn', 'winter']);
    assert.equal(normalized?.formality, 'smart-casual');
  });
});

describe('normalizeMainCategory', () => {
  it('accepts canonical enum values', () => {
    assert.equal(normalizeMainCategory('OUTERWEAR'), 'OUTERWEAR');
  });

  it('normalizes casing and aliases', () => {
    assert.equal(normalizeMainCategory('outerwear'), 'OUTERWEAR');
    assert.equal(normalizeMainCategory('Shoes'), 'FOOTWEAR');
    assert.equal(normalizeMainCategory('dress'), 'ONE_PIECE');
  });
});

describe('normalizeWardrobeAnalysis', () => {
  it('coerces string arrays and lowercase mainCategory', () => {
    const normalized = normalizeWardrobeAnalysis({
      mainCategory: 'top',
      subCategory: 'T-shirt',
      season: 'Spring, Summer',
      material: 'cotton',
      colors: 'white',
      tags: ['casual'],
      description: 'A white tee.',
      searchDescription: 'Casual tee for commute and weekend.',
      occasions: 'office, commute',
      formality: 'casual',
      silhouette: ['regular'],
    });

    assert.ok(normalized);
    assert.equal(normalized?.mainCategory, 'TOP');
    assert.deepEqual(normalized?.season, ['spring', 'summer']);
    assert.deepEqual(normalized?.material, ['cotton']);
    assert.deepEqual(normalized?.colors, ['white']);
    assert.deepEqual(normalized?.occasions, ['office', 'commute']);
    assert.equal(normalized?.searchDescription, 'Casual tee for commute and weekend.');
    assert.equal(normalized?.tempMin, null);
    assert.equal(normalized?.tempMax, null);
  });

  it('keeps an appropriate temperature range and swaps inverted bounds', () => {
    const normalized = normalizeWardrobeAnalysis({
      mainCategory: 'OUTERWEAR',
      subCategory: 'Puffer Jacket',
      season: ['Winter'],
      material: ['down'],
      colors: ['gray'],
      tags: ['warm'],
      description: 'A gray hooded puffer.',
      tempMin: 20,
      tempMax: 5,
    });
    assert.equal(normalized?.tempMin, 5);
    assert.equal(normalized?.tempMax, 20);
  });

  it('returns null when required fields are missing', () => {
    assert.equal(normalizeWardrobeAnalysis({ mainCategory: 'TOP' }), null);
  });
});
