import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMainCategory,
  normalizeWardrobeAnalysis,
} from '@/server/utils/wardrobeAnalysis';

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
  });

  it('returns null when required fields are missing', () => {
    assert.equal(normalizeWardrobeAnalysis({ mainCategory: 'TOP' }), null);
  });
});
