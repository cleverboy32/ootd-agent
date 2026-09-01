import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  buildSeedreamRequestBody,
  isSeedreamImageVendor,
  SEEDREAM_MAX_REFERENCE_IMAGES,
} from '@/server/services/llm/seedream';

const originalVendor = process.env.IMAGE_VENDOR;

before(() => {
  process.env.IMAGE_VENDOR = 'bytedance';
});

after(() => {
  if (originalVendor === undefined) delete process.env.IMAGE_VENDOR;
  else process.env.IMAGE_VENDOR = originalVendor;
});

describe('Seedream image vendor routing', () => {
  it('detects ByteDance / volc / seedream image vendors', () => {
    assert.equal(isSeedreamImageVendor(), true);
    process.env.IMAGE_VENDOR = 'seedream';
    assert.equal(isSeedreamImageVendor(), true);
    process.env.IMAGE_VENDOR = 'minimax';
    assert.equal(isSeedreamImageVendor(), false);
    process.env.IMAGE_VENDOR = 'bytedance';
  });

  it('builds multi-reference request body', () => {
    const body = buildSeedreamRequestBody({
      prompt: 'model wearing outfit',
      model: 'ep-20260803120305-xvm9r',
      referenceImageUrls: ['https://example.com/top.jpg', 'https://example.com/bottom.jpg'],
      size: '2K',
    });

    assert.equal(body.model, 'ep-20260803120305-xvm9r');
    assert.deepEqual(body.image, ['https://example.com/top.jpg', 'https://example.com/bottom.jpg']);
    assert.equal(body.sequential_image_generation, 'disabled');
    assert.equal(body.watermark, false);
    assert.equal(body.size, '2K');
  });

  it('defaults image size to 3:4 portrait when size omitted', () => {
    const body = buildSeedreamRequestBody({
      prompt: 'test',
      model: 'ep-test',
    });
    assert.equal(body.size, '1728x2304');
  });

  it('uses a single string when only one reference image is provided', () => {
    const body = buildSeedreamRequestBody({
      prompt: 'test',
      model: 'ep-test',
      referenceImageUrls: ['https://example.com/one.jpg'],
    });
    assert.equal(body.image, 'https://example.com/one.jpg');
  });

  it('caps reference images at the Seedream limit', () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://example.com/${i}.jpg`);
    const body = buildSeedreamRequestBody({
      prompt: 'test',
      model: 'ep-test',
      referenceImageUrls: urls,
    });
    assert.equal(Array.isArray(body.image), true);
    assert.equal((body.image as string[]).length, SEEDREAM_MAX_REFERENCE_IMAGES);
  });
});
