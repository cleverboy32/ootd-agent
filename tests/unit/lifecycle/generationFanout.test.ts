import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  attachFanoutMessageId,
  completeGenerationFanoutEntry,
  discardGenerationFanoutByConversation,
  getFanoutBufferForTests,
  getFanoutByMessageId,
  getFanoutSubscriberCountForTests,
  openGenerationFanout,
  publishGenerationEvent,
  resetGenerationFanoutForTests,
  subscribeGenerationFanout,
  subscribeGenerationFanoutByConversation,
} from '@/server/lifecycle/generationFanout';

afterEach(() => {
  resetGenerationFanoutForTests();
});

function mockController() {
  const chunks: string[] = [];
  const controller = {
    desiredSize: 1 as number | null,
    enqueue(chunk: Uint8Array) {
      chunks.push(new TextDecoder().decode(chunk));
    },
    close() {
      controller.desiredSize = null;
    },
  };
  return { controller: controller as unknown as ReadableStreamDefaultController, chunks };
}

describe('generationFanout', () => {
  it('publish always appends to buffer even without subscribers', () => {
    openGenerationFanout('conv-1');
    publishGenerationEvent('conv-1', 'text_chunk', { text: 'hello' });
    publishGenerationEvent('conv-1', 'progress', { stage: 'stylist' });

    assert.deepEqual(getFanoutBufferForTests('conv-1'), [
      { eventName: 'text_chunk', data: { text: 'hello' } },
      { eventName: 'progress', data: { stage: 'stylist' } },
    ]);
    assert.equal(getFanoutSubscriberCountForTests('conv-1'), 0);
  });

  it('subscribe replays full buffer then receives live events', () => {
    openGenerationFanout('conv-1');
    publishGenerationEvent('conv-1', 'metadata', { messageId: 'm1' });
    publishGenerationEvent('conv-1', 'text_chunk', { text: 'a' });

    const { controller, chunks } = mockController();
    subscribeGenerationFanoutByConversation('conv-1', controller);

    const replay = chunks.join('');
    assert.match(replay, /event: metadata/);
    assert.match(replay, /event: text_chunk/);
    assert.match(replay, /"text":"a"/);

    chunks.length = 0;
    publishGenerationEvent('conv-1', 'text_chunk', { text: 'b' });
    const live = chunks.join('');
    assert.match(live, /"text":"b"/);
    assert.equal(getFanoutSubscriberCountForTests('conv-1'), 1);
  });

  it('discard clears buffer so subscribe cannot resume old events', () => {
    openGenerationFanout('conv-1');
    attachFanoutMessageId('conv-1', 'm1');
    publishGenerationEvent('conv-1', 'text_chunk', { text: 'old' });

    discardGenerationFanoutByConversation('conv-1');
    assert.equal(getFanoutByMessageId('m1'), undefined);
    assert.deepEqual(getFanoutBufferForTests('conv-1'), []);

    const { controller, chunks } = mockController();
    assert.equal(subscribeGenerationFanout('m1', controller), false);
    assert.equal(chunks.length, 0);
  });

  it('complete marks entry done and clears buffer after TTL path via entry identity', () => {
    const entry = openGenerationFanout('conv-1');
    attachFanoutMessageId('conv-1', 'm1');
    publishGenerationEvent('conv-1', 'text_chunk', { text: 'x' });

    const { controller } = mockController();
    subscribeGenerationFanout('m1', controller);
    assert.equal(getFanoutSubscriberCountForTests('conv-1'), 1);

    completeGenerationFanoutEntry(entry);
    assert.equal(getFanoutSubscriberCountForTests('conv-1'), 0);
    // buffer still indexed until TTL; entry still findable briefly
    assert.ok(getFanoutByMessageId('m1'));
    assert.equal(getFanoutByMessageId('m1')?.completed, true);
  });

  it('complete on superseded entry does not touch the new fanout', () => {
    const oldEntry = openGenerationFanout('conv-1');
    publishGenerationEvent('conv-1', 'text_chunk', { text: 'old' });

    const newEntry = openGenerationFanout('conv-1');
    publishGenerationEvent('conv-1', 'text_chunk', { text: 'new' });

    completeGenerationFanoutEntry(oldEntry);
    assert.deepEqual(getFanoutBufferForTests('conv-1'), [
      { eventName: 'text_chunk', data: { text: 'new' } },
    ]);
    assert.equal(newEntry.completed, false);
  });
});
