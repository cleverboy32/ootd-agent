import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWardrobeDocumentEmbeddingText,
  buildWardrobeQueryEmbeddingText,
} from '@/server/utils/embeddingText';

describe('buildWardrobeQueryEmbeddingText', () => {
  it('keeps full document field structure with intent hints', () => {
    const text = buildWardrobeQueryEmbeddingText('beige A-line midi dress with belt for office', {
      slot: 'skirt',
      intent: {
        dressing_climate: 'warm',
        occasion: 'office commute',
        style_preference: 'minimal',
      } as never,
    });

    assert.match(
      text,
      /^MainCategory: ONE_PIECE\. Category: skirt\. Description: beige A-line midi dress with belt for office\./
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
    const text = buildWardrobeQueryEmbeddingText('白色裙子', { slot: 'skirt' });
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
      tempMin: 16,
      tempMax: 26,
    });
    assert.match(text, /^MainCategory: BOTTOM\. Category: Wide-Leg Trousers\./);
    assert.match(text, /TempSuitable: 16-26℃\./);
  });

  it('query injects mainCategory from slot', () => {
    const text = buildWardrobeQueryEmbeddingText('tailored trousers office commute', {
      slot: 'bottom',
    });
    assert.match(text, /^MainCategory: BOTTOM\. Category: bottom\./);
  });

  it('query injects TempSuitable from slotTempRange', () => {
    const text = buildWardrobeQueryEmbeddingText('厚针织毛衣内搭', {
      slot: 'top',
      slotTempRange: { min: 5, max: 14 },
    });
    assert.match(text, /TempSuitable: 5-14℃\./);
  });

  it('omits TempSuitable when both bounds null', () => {
    const text = buildWardrobeDocumentEmbeddingText({
      mainCategory: 'ACCESSORY',
      subCategory: '耳环',
      description: '金耳钉',
      tempMin: null,
      tempMax: null,
    });
    assert.doesNotMatch(text, /TempSuitable/);
  });
});
