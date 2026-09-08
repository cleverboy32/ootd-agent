import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ensureLlmSafeImageBuffer,
  isLlmSafeImageMime,
  normalizeImageMime,
} from '@/server/utils/image';

describe('normalizeImageMime', () => {
  it('strips charset and lowercases', () => {
    assert.equal(normalizeImageMime('image/AVIF; charset=binary'), 'image/avif');
    assert.equal(normalizeImageMime(null), '');
  });
});

describe('isLlmSafeImageMime', () => {
  it('accepts common multimodal formats', () => {
    assert.equal(isLlmSafeImageMime('image/jpeg'), true);
    assert.equal(isLlmSafeImageMime('image/png'), true);
    assert.equal(isLlmSafeImageMime('image/webp'), true);
    assert.equal(isLlmSafeImageMime('image/gif'), true);
  });

  it('rejects avif/heic that providers often mislabel as octet-stream', () => {
    assert.equal(isLlmSafeImageMime('image/avif'), false);
    assert.equal(isLlmSafeImageMime('image/heic'), false);
  });
});

describe('ensureLlmSafeImageBuffer', () => {
  it('passes through jpeg unchanged', async () => {
    // Minimal valid 1x1 JPEG
    const jpeg = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z',
      'base64'
    );
    const result = await ensureLlmSafeImageBuffer(jpeg, 'image/jpeg');
    assert.equal(result.mimeType, 'image/jpeg');
    assert.equal(result.buffer.equals(jpeg), true);
  });

  it('converts avif to jpeg via sharp', async () => {
    const sharp = (await import('sharp')).default;
    const avif = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 40, b: 60 } },
    })
      .avif()
      .toBuffer();

    const result = await ensureLlmSafeImageBuffer(avif, 'image/avif');
    assert.equal(result.mimeType, 'image/jpeg');
    assert.ok(result.buffer.length > 0);
    assert.notEqual(result.buffer.equals(avif), true);
  });
});
