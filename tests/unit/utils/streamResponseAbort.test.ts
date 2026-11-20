import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { streamResponse, type StreamHandlers } from '@/lib/utils';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function quietHandlers(overrides: Partial<StreamHandlers> = {}): StreamHandlers {
  return {
    onMetadata: () => undefined,
    onTextChunk: () => undefined,
    onImagePlaceholder: () => undefined,
    onImageGenerated: () => undefined,
    onImageGenerationFailed: () => undefined,
    onError: () => undefined,
    onStreamEnd: () => undefined,
    ...overrides,
  };
}

describe('streamResponse abort', () => {
  it('calls onCancelled instead of onError when the signal aborts', async () => {
    const ac = new AbortController();
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal?.addEventListener(
          'abort',
          () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')),
          { once: true }
        );
      });
    }) as typeof fetch;

    let cancelled = false;
    let errored = false;
    const pending = streamResponse(
      { conversationId: 'c1', content: { text: 'hi' } },
      quietHandlers({
        onCancelled: () => {
          cancelled = true;
        },
        onError: () => {
          errored = true;
        },
      }),
      { signal: ac.signal }
    );

    ac.abort(new DOMException('test abort', 'AbortError'));
    await pending;

    assert.equal(cancelled, true);
    assert.equal(errored, false);
  });
});
