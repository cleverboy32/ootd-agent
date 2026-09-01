import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { usesByteDanceMultimodalEmbedding } from '@/server/services/llm/bytedance';

const originalVendor = process.env.EMBEDDING_VENDOR;
const originalModel = process.env.EMBEDDING_MODEL;

before(() => {
  process.env.EMBEDDING_VENDOR = 'bytedance';
});

after(() => {
  if (originalVendor === undefined) delete process.env.EMBEDDING_VENDOR;
  else process.env.EMBEDDING_VENDOR = originalVendor;
  if (originalModel === undefined) delete process.env.EMBEDDING_MODEL;
  else process.env.EMBEDDING_MODEL = originalModel;
});

describe('ByteDance multimodal embedding routing', () => {
  it('routes endpoint ids and vision model names to the multimodal API', () => {
    assert.equal(usesByteDanceMultimodalEmbedding('ep-20260831113153-7hkg7'), true);
    assert.equal(usesByteDanceMultimodalEmbedding('doubao-embedding-vision-251215'), true);
    assert.equal(usesByteDanceMultimodalEmbedding('doubao-embedding-large-text-250515'), false);
  });
});
