import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWardrobeDocumentEmbeddingText,
  buildWardrobeQueryEmbeddingText,
  stripEmbeddingTemperatures,
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
    assert.doesNotMatch(text, /Visual:/);
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
    const item = {
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
    };
    const text = buildWardrobeDocumentEmbeddingText(item);
    assert.match(text, /^MainCategory: BOTTOM\. Category: Wide-Leg Trousers\./);
    assert.doesNotMatch(text, /TempSuitable|16-26/);
  });

  it('query injects mainCategory from slot', () => {
    const text = buildWardrobeQueryEmbeddingText('tailored trousers office commute', {
      slot: 'bottom',
    });
    assert.match(text, /^MainCategory: BOTTOM\. Category: bottom\./);
  });

  it('removes numeric temperature from fixed queries while keeping fabric and layering', () => {
    const query = '薄贴身发热内搭裤，穿在全长外裤内，适合温度-15到4度';
    const plain = '薄贴身发热内搭裤，穿在全长外裤内';
    assert.equal(stripEmbeddingTemperatures(query), plain);
    assert.equal(buildWardrobeQueryEmbeddingText(query), buildWardrobeQueryEmbeddingText(plain));
    assert.equal(stripEmbeddingTemperatures('80-120D 袜裤，适合不低于12度单穿'), '80-120D 袜裤');
    assert.equal(stripEmbeddingTemperatures('360度裙摆'), '360度裙摆');
  });

  it('removes temperatures embedded in item descriptions', () => {
    const text = buildWardrobeDocumentEmbeddingText({
      subCategory: '毛呢长裙',
      description: '格纹长裙，4–11℃，蕾丝裙边',
      searchDescription: '秋冬通勤，约 4°C 至 11°C 搭配针织衫',
    });
    assert.doesNotMatch(text, /℃|°C|4|11/);
    assert.match(text, /格纹长裙，蕾丝裙边/);
    assert.match(text, /搭配针织衫/);
  });
});
