import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getInFlightCount,
  isShuttingDown,
  registerInFlight,
  unregisterInFlight,
} from '@/server/lifecycle/shutdown';

describe('shutdown lifecycle registry', () => {
  it('starts not shutting down with empty registry', () => {
    assert.equal(isShuttingDown(), false);
    assert.equal(getInFlightCount(), 0);
  });

  it('registerInFlight tracks entries until unregister', () => {
    const ac = new AbortController();
    registerInFlight('req-a', ac, Promise.resolve());
    assert.equal(getInFlightCount(), 1);
    unregisterInFlight('req-a');
    assert.equal(getInFlightCount(), 0);
  });

  it('abort controller stops in-flight work cooperatively', async () => {
    const ac = new AbortController();
    let caught = false;

    registerInFlight(
      'req-b',
      ac,
      new Promise<void>((resolve) => {
        ac.signal.addEventListener('abort', () => {
          caught = true;
          resolve();
        });
      })
    );

    ac.abort(new DOMException('test abort', 'AbortError'));
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.equal(caught, true);
    assert.equal(ac.signal.aborted, true);
    unregisterInFlight('req-b');
  });
});

describe('withRetryOn429 abort', () => {
  it('does not retry AbortError', async () => {
    const { withRetryOn429 } = await import('@/server/utils/retryOn429');
    let calls = 0;

    await assert.rejects(
      () =>
        withRetryOn429(async () => {
          calls += 1;
          throw new DOMException('Aborted', 'AbortError');
        }, { maxRetries: 3 }),
      (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
    );

    assert.equal(calls, 1);
  });
});
