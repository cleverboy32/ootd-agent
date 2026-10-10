/**
 * 登录/找回失败锁定（纯函数；状态持久化在 User 表）。
 * 规则：连续 5 次失败锁定 15 分钟；成功清零；锁过期后重新计数。
 */

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

export interface LockoutState {
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

export function getLockStatus(
  state: LockoutState,
  now = Date.now()
): { locked: boolean; retryAfterSec: number } {
  if (state.lockedUntil && state.lockedUntil.getTime() > now) {
    return {
      locked: true,
      retryAfterSec: Math.ceil((state.lockedUntil.getTime() - now) / 1000),
    };
  }
  return { locked: false, retryAfterSec: 0 };
}

/** 记录一次失败，返回应持久化的新状态 */
export function registerFailure(state: LockoutState, now = Date.now()): LockoutState {
  // 上一次锁已过期则从 0 重新计数
  const base =
    state.lockedUntil && state.lockedUntil.getTime() <= now ? 0 : state.failedLoginAttempts;
  const failedLoginAttempts = base + 1;
  const lockedUntil =
    failedLoginAttempts >= MAX_FAILED_ATTEMPTS ? new Date(now + LOCK_DURATION_MS) : null;
  return { failedLoginAttempts, lockedUntil };
}

/** 成功后清零 */
export function resetFailures(): LockoutState {
  return { failedLoginAttempts: 0, lockedUntil: null };
}
