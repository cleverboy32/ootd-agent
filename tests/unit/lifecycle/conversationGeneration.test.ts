import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  getConversationGenerationCountForTests,
  registerConversationGeneration,
  resetConversationGenerationForTests,
  supersedeConversationGeneration,
  unregisterConversationGeneration,
} from '@/server/lifecycle/conversationGeneration';
import {
  getFanoutBufferForTests,
  openGenerationFanout,
  publishGenerationEvent,
  resetGenerationFanoutForTests,
} from '@/server/lifecycle/generationFanout';
import { isAbortError, isSupersededAbortError } from '@/server/utils/abort';

afterEach(() => {
  resetConversationGenerationForTests();
  resetGenerationFanoutForTests();
});

describe('conversationGeneration registry', () => {
  it('supersede aborts the previous controller for the same conversation', () => {
    const first = new AbortController();
    registerConversationGeneration('conv-1', 'flight-1', first);
    assert.equal(getConversationGenerationCountForTests(), 1);

    const supersededId = supersedeConversationGeneration('conv-1');
    assert.equal(supersededId, 'flight-1');
    assert.equal(first.signal.aborted, true);
    assert.equal(isAbortError(first.signal.reason), true);
    assert.equal(isSupersededAbortError(first.signal.reason), true);
    assert.equal(getConversationGenerationCountForTests(), 0);

    const second = new AbortController();
    registerConversationGeneration('conv-1', 'flight-2', second);
    assert.equal(second.signal.aborted, false);
    assert.equal(getConversationGenerationCountForTests(), 1);
  });

  it('unregister only clears matching inFlightId', () => {
    const first = new AbortController();
    registerConversationGeneration('conv-1', 'flight-1', first);
    supersedeConversationGeneration('conv-1');
    const second = new AbortController();
    registerConversationGeneration('conv-1', 'flight-2', second);

    unregisterConversationGeneration('conv-1', 'flight-1');
    assert.equal(getConversationGenerationCountForTests(), 1);

    unregisterConversationGeneration('conv-1', 'flight-2');
    assert.equal(getConversationGenerationCountForTests(), 0);
  });

  it('different conversations do not supersede each other', () => {
    const a = new AbortController();
    const b = new AbortController();
    registerConversationGeneration('conv-a', 'a1', a);
    registerConversationGeneration('conv-b', 'b1', b);

    supersedeConversationGeneration('conv-a');
    assert.equal(a.signal.aborted, true);
    assert.equal(b.signal.aborted, false);
  });

  it('supersede discards generation fanout buffer for that conversation', () => {
    openGenerationFanout('conv-1');
    publishGenerationEvent('conv-1', 'text_chunk', { text: 'old' });
    const first = new AbortController();
    registerConversationGeneration('conv-1', 'flight-1', first);

    supersedeConversationGeneration('conv-1');
    assert.deepEqual(getFanoutBufferForTests('conv-1'), []);
    assert.equal(first.signal.aborted, true);
  });
});
