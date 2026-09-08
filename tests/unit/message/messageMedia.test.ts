import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractUserMessageMedia } from '@/lib/messageMedia';

describe('extractUserMessageMedia', () => {
  it('reads image from content parts (primary storage)', () => {
    const result = extractUserMessageMedia({
      content: [
        { type: 'text', content: '打算买这条裤子' },
        { type: 'image', content: 'https://example.com/pants.avif' },
      ],
    });
    assert.equal(result.text, '打算买这条裤子');
    assert.equal(result.imageUrl, 'https://example.com/pants.avif');
  });

  it('falls back to message.imageUrl when parts have no image', () => {
    const result = extractUserMessageMedia({
      content: [{ type: 'text', content: 'hello' }],
      imageUrl: 'https://example.com/legacy.jpg',
    });
    assert.equal(result.imageUrl, 'https://example.com/legacy.jpg');
  });

  it('prefers content part over legacy imageUrl', () => {
    const result = extractUserMessageMedia({
      content: [{ type: 'image', content: 'https://example.com/from-part.jpg' }],
      imageUrl: 'https://example.com/legacy.jpg',
    });
    assert.equal(result.imageUrl, 'https://example.com/from-part.jpg');
  });
});
