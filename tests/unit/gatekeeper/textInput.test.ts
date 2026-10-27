import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { imageCountFact, stripHistoryImages, stripImageParts } from '@/server/agents/gatekeeper/textInput';

describe('stripImageParts', () => {
  it('drops inline images and keeps text', () => {
    const parts = stripImageParts([
      { inlineData: { data: 'abc', mimeType: 'image/jpeg' } },
      { text: '明天开会怎么穿' },
    ]);

    assert.deepEqual(parts, [{ text: '明天开会怎么穿' }]);
  });

  it('drops image parts from history turns', () => {
    const history = stripHistoryImages([
      {
        role: 'user',
        parts: [{ inlineData: { data: 'abc', mimeType: 'image/jpeg' } }, { text: '帮我搭这件' }],
      },
      { role: 'model', parts: [{ text: '好的' }] },
    ]);

    assert.equal(history.length, 2);
    assert.deepEqual(history[0].parts, [{ text: '帮我搭这件' }]);
  });
});

describe('imageCountFact', () => {
  it('states the upload count without describing the picture', () => {
    const fact = imageCountFact(2);
    assert.match(fact, /2 张图片/);
    assert.match(fact, /看不到画面/);
    assert.equal(imageCountFact(0), '');
  });
});
