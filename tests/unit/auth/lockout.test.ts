import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getLockStatus,
  LOCK_DURATION_MS,
  MAX_FAILED_ATTEMPTS,
  registerFailure,
  resetFailures,
} from '@/server/auth/lockout';

const T0 = Date.UTC(2026, 9, 10, 12, 0, 0);

describe('login lockout', () => {
  it('locks after MAX_FAILED_ATTEMPTS consecutive failures', () => {
    let state = resetFailures();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i += 1) {
      state = registerFailure(state, T0);
      assert.equal(getLockStatus(state, T0).locked, false);
    }

    state = registerFailure(state, T0);
    const status = getLockStatus(state, T0);
    assert.equal(status.locked, true);
    assert.equal(status.retryAfterSec, LOCK_DURATION_MS / 1000);
  });

  it('unlocks after the lock duration and restarts counting', () => {
    let state = resetFailures();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
      state = registerFailure(state, T0);
    }

    const afterLock = T0 + LOCK_DURATION_MS + 1000;
    assert.equal(getLockStatus(state, afterLock).locked, false);

    // 锁过期后再次失败从 1 重新计数
    state = registerFailure(state, afterLock);
    assert.equal(state.failedLoginAttempts, 1);
    assert.equal(state.lockedUntil, null);
  });

  it('resets on success', () => {
    let state = registerFailure(resetFailures(), T0);
    state = registerFailure(state, T0);
    assert.equal(state.failedLoginAttempts, 2);

    const cleared = resetFailures();
    assert.deepEqual(cleared, { failedLoginAttempts: 0, lockedUntil: null });
  });

  it('counts down remaining lock time', () => {
    let state = resetFailures();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
      state = registerFailure(state, T0);
    }

    const fiveMinutesIn = T0 + 5 * 60 * 1000;
    const status = getLockStatus(state, fiveMinutesIn);
    assert.equal(status.locked, true);
    assert.equal(status.retryAfterSec, 10 * 60);
  });
});
