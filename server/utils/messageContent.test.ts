import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyImageResultsToText,
  buildImageStates,
  buildPersistedMessageContent,
  extractImageStates,
  extractStylistCache,
  extractTextContent,
  patchMessageImageResult,
} from './messageContent';

describe('messageContent', () => {
  const stylistCache = {
    type: 'stylist_cache' as const,
    stylist_result: {
      outfits: [
        {
          id: 'outfit_1',
          overall_concept: '测试方案',
          selected_items: [],
          visual_composition: {
            model_pose: 'standing naturally',
            outfit_details: 'casual outfit',
            background: 'studio backdrop',
          },
        },
      ],
    },
    user_profile: {
      name: '',
      height: '',
      weight: '',
      preferences: [],
      skin_tone: '',
      body_shape: '',
      personal_style: '甜美',
      visual_features: { hair_color: 'unknown', detected_features: 'none' },
    },
    wardrobe_items: [],
  } satisfies import('./messageContent').StylistCacheNode;

  it('buildPersistedMessageContent keeps stylist_cache alongside text', () => {
    const parts = buildPersistedMessageContent({
      text: 'hello [IMAGE=outfit_1]',
      stylistCache,
      imageStates: { outfit_1: 'failed' },
    });

    assert.equal(parts.length, 3);
    assert.ok(extractStylistCache(parts));
    assert.equal(extractImageStates(parts).outfit_1, 'failed');
  });

  it('applyImageResultsToText only replaces successful placeholders', () => {
    const text = 'A [IMAGE=outfit_1]\n\nB [IMAGE=outfit_2]';
    const map = new Map([['outfit_1', 'https://example.com/1.png']]);
    const result = applyImageResultsToText(text, map);

    assert.ok(result.includes('https://example.com/1.png'));
    assert.ok(result.includes('[IMAGE=outfit_2]'));
  });

  it('buildImageStates marks failed outfits', () => {
    const states = buildImageStates(
      ['outfit_1', 'outfit_2'],
      new Map([['outfit_1', 'https://x.png']]),
      new Set(['outfit_2'])
    );
    assert.equal(states.outfit_1, 'https://x.png');
    assert.equal(states.outfit_2, 'failed');
  });

  it('patchMessageImageResult updates text and image_states', () => {
    const original = buildPersistedMessageContent({
      text: '方案 [IMAGE=outfit_1]',
      stylistCache,
      imageStates: { outfit_1: 'failed' },
    });

    const patched = patchMessageImageResult(original, 'outfit_1', 'https://new.png');
    assert.ok(extractTextContent(patched).includes('https://new.png'));
    assert.equal(extractImageStates(patched).outfit_1, 'https://new.png');
    assert.ok(extractStylistCache(patched));
  });
});
