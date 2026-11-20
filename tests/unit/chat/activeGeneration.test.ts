import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  beginGeneration,
  endGeneration,
  getActiveGenerationId,
  isCurrentGeneration,
  resetActiveGenerationForTests,
  setActiveAiMessageId,
  getActiveAiMessageId,
} from '@/lib/chat/activeGeneration';

afterEach(() => {
  resetActiveGenerationForTests();
});

describe('activeGeneration', () => {
  it('beginGeneration aborts the previous controller', () => {
    const first = beginGeneration();
    assert.equal(first.signal.aborted, false);

    const second = beginGeneration();
    assert.equal(first.signal.aborted, true);
    assert.equal(second.signal.aborted, false);
    assert.equal(isCurrentGeneration(first.generationId), false);
    assert.equal(isCurrentGeneration(second.generationId), true);
  });

  it('endGeneration of an old id does not clear the current generation', () => {
    const first = beginGeneration();
    setActiveAiMessageId('ai-1');
    const second = beginGeneration();
    setActiveAiMessageId('ai-2');

    endGeneration(first.generationId);
    assert.equal(getActiveGenerationId(), second.generationId);
    assert.equal(getActiveAiMessageId(), 'ai-2');

    endGeneration(second.generationId);
    assert.equal(getActiveAiMessageId(), null);
  });
});
