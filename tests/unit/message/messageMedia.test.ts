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
    assert.deepEqual(result.imageUrls, ['https://example.com/pants.avif']);
  });

  it('keeps every uploaded item on one message, capped at four', () => {
    const result = extractUserMessageMedia({
      content: [
        { type: 'image', content: 'https://example.com/1.jpg' },
        { type: 'image', content: 'https://example.com/2.jpg' },
        { type: 'image', content: 'https://example.com/3.jpg' },
        { type: 'image', content: 'https://example.com/4.jpg' },
        { type: 'image', content: 'https://example.com/5.jpg' },
      ],
    });
    assert.equal(result.imageUrls.length, 4);
    assert.equal(result.imageUrls[3], 'https://example.com/4.jpg');
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
