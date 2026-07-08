import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWardrobeDocumentEmbeddingText,
  buildWardrobeQueryEmbeddingText,
} from '@/server/utils/embeddingText';

describe('buildWardrobeDocumentEmbeddingText', () => {
  it('matches the legacy wardrobe upload format', () => {
    const text = buildWardrobeDocumentEmbeddingText({
      subCategory: 'Biker Shorts',
      description: 'Black athletic shorts for training.',
      colors: ['black'],
      tags: ['athletic', 'sporty'],
      season: ['summer'],
      material: ['polyester'],
    });

    assert.equal(
      text,
      'Category: Biker Shorts. Description: Black athletic shorts for training.. Colors: black. Tags: athletic, sporty. Season: summer. Material: polyester.'
    );
  });
});

describe('buildWardrobeQueryEmbeddingText', () => {
  it('formats stylist query with slot and intent hints', () => {
    const text = buildWardrobeQueryEmbeddingText('beige A-line midi dress with belt for office', {
      slot: 'dress',
      intent: {
        dressing_climate: 'warm',
        occasion: 'office commute',
        style_preference: 'minimal',
      } as never,
    });

    assert.match(text, /^Category: dress\. Description: beige A-line midi dress with belt for office\./);
    assert.match(text, /Season: summer\./);
    assert.match(text, /Tags: office commute, minimal\./);
  });

  it('infers category from query when slot is missing', () => {
    const text = buildWardrobeQueryEmbeddingText('comfortable brown leather flat sandals');
    assert.match(text, /^Category: footwear\./);
  });

  it('keeps Chinese resolver queries in description field', () => {
    const text = buildWardrobeQueryEmbeddingText('白色裙子', { slot: 'dress' });
    assert.match(text, /^Category: dress\. Description: 白色裙子\./);
  });
});
