import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWardrobeDocumentEmbeddingText,
  buildWardrobeQueryEmbeddingText,
} from '@/server/utils/embeddingText';

describe('buildWardrobeQueryEmbeddingText', () => {
  it('keeps full document field structure with intent hints', () => {
    const text = buildWardrobeQueryEmbeddingText('beige A-line midi dress with belt for office', {
      slot: 'dress',
      intent: {
        dressing_climate: 'warm',
        occasion: 'office commute',
        style_preference: 'minimal',
      } as never,
    });

    assert.match(
      text,
      /^MainCategory: ONE_PIECE\. Category: dress\. Description: beige A-line midi dress with belt for office\./
    );
    assert.match(text, /Colors: beige\./);
    assert.match(text, /Season: summer\./);
    assert.match(text, /Tags: office commute, minimal\./);
    assert.match(text, /Occasions: office commute\./);
    assert.match(text, /Visual: \./);
  });

  it('does not false-positive red from tailored', () => {
    const text = buildWardrobeQueryEmbeddingText(
      'tailored trousers or wide leg pants office commute',
      { slot: 'bottom' }
    );
    assert.doesNotMatch(text, /Colors: red/);
  });

  it('extracts Chinese color for dress resolver queries', () => {
    const text = buildWardrobeQueryEmbeddingText('白色裙子', { slot: 'dress' });
    assert.match(text, /Colors: white\./);
    assert.match(text, /Description: 白色裙子\./);
  });

  it('does not false-positive bottom from short sleeve', () => {
    const text = buildWardrobeQueryEmbeddingText('oatmeal knit short sleeve top for commute');
    assert.match(text, /^MainCategory: TOP\. Category: top\./);
  });
});

describe('buildWardrobeDocumentEmbeddingText', () => {
  it('formats document text with mainCategory aligned to DB enum', () => {
    const text = buildWardrobeDocumentEmbeddingText({
      mainCategory: 'BOTTOM',
      subCategory: 'Wide-Leg Trousers',
      description: 'Cream wide-leg pants.',
      searchDescription: 'Office commute wide-leg trousers.',
      colors: ['cream'],
      tags: ['casual'],
      season: ['summer'],
      material: ['linen'],
    });
    assert.match(text, /^MainCategory: BOTTOM\. Category: Wide-Leg Trousers\./);
  });

  it('query injects mainCategory from slot', () => {
    const text = buildWardrobeQueryEmbeddingText('tailored trousers office commute', {
      slot: 'bottom',
    });
    assert.match(text, /^MainCategory: BOTTOM\. Category: bottom\./);
  });
});
