import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startSseHeartbeat } from '@/server/utils/stream-helpers';

function createMockController() {
  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();
  const controller = {
    desiredSize: 1 as number | null,
    enqueue(chunk: Uint8Array) {
      chunks.push(chunk);
    },
  };
  return {
    controller: controller as unknown as ReadableStreamDefaultController,
    text: () => chunks.map((c) => decoder.decode(c)).join(''),
    close() {
      controller.desiredSize = null;
    },
  };
}

describe('startSseHeartbeat', () => {
  it('emits ping events on interval and stops cleanly', async () => {
    const ac = new AbortController();
    const mock = createMockController();
    const stop = startSseHeartbeat(mock.controller, ac.signal, 20);

    await new Promise((r) => setTimeout(r, 55));
    stop();

    const body = mock.text();
    const pings = body.match(/event: ping\n/g) ?? [];
    assert.ok(pings.length >= 2, `expected >=2 pings, got ${pings.length}: ${body}`);

    const afterStop = body;
    await new Promise((r) => setTimeout(r, 45));
    assert.equal(mock.text(), afterStop, 'no more pings after stop()');
  });

  it('stops when abort signal fires', async () => {
    const ac = new AbortController();
    const mock = createMockController();
    startSseHeartbeat(mock.controller, ac.signal, 20);

    await new Promise((r) => setTimeout(r, 25));
    ac.abort();
    const afterAbort = mock.text();

    await new Promise((r) => setTimeout(r, 45));
    assert.equal(mock.text(), afterAbort, 'no more pings after abort');
  });
});
