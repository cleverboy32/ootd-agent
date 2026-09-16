import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createShutdownAbortError,
  isAbortError,
  throwIfAborted,
} from '@/server/utils/abort';

describe('abort utils', () => {
  it('throwIfAborted throws when signal is aborted', () => {
    const ac = new AbortController();
    ac.abort();
    assert.throws(() => throwIfAborted(ac.signal), (error: unknown) => isAbortError(error));
  });

  it('isAbortError recognizes DOMException AbortError', () => {
    assert.equal(isAbortError(new DOMException('x', 'AbortError')), true);
    assert.equal(isAbortError(new Error('other')), false);
  });

  it('createShutdownAbortError includes signal name', () => {
    const error = createShutdownAbortError('SIGTERM');
    assert.equal(error.name, 'AbortError');
    assert.match(error.message, /SIGTERM/);
  });
});
