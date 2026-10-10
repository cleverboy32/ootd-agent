import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  createSessionToken,
  isSessionConfigured,
  verifySessionToken,
} from '@/server/auth/session';

const originalSecret = process.env.USER_SESSION_SECRET;

before(() => {
  process.env.USER_SESSION_SECRET = 'test-user-session-secret-32-chars!';
});

after(() => {
  if (originalSecret === undefined) delete process.env.USER_SESSION_SECRET;
  else process.env.USER_SESSION_SECRET = originalSecret;
});

describe('user session token', () => {
  it('is configured only with a >=32 chars secret', () => {
    assert.equal(isSessionConfigured(), true);
    process.env.USER_SESSION_SECRET = 'short';
    assert.equal(isSessionConfigured(), false);
    process.env.USER_SESSION_SECRET = 'test-user-session-secret-32-chars!';
  });

  it('signs and verifies a token with full payload', async () => {
    const now = Date.UTC(2026, 9, 10);
    const token = await createSessionToken('user-123', 2, now);
    const payload = await verifySessionToken(token, now);

    assert.deepEqual(payload, {
      userId: 'user-123',
      sessionVersion: 2,
      expiresAt: Math.floor(now / 1000) + 30 * 24 * 60 * 60,
    });
  });

  it('rejects tampered tokens', async () => {
    const now = Date.UTC(2026, 9, 10);
    const token = await createSessionToken('user-123', 0, now);

    assert.equal(await verifySessionToken(`${token}x`, now), null);
    // 篡改 payload 中的 userId
    const parts = token.split('.');
    parts[1] = 'attacker';
    assert.equal(await verifySessionToken(parts.join('.'), now), null);
    // 段数不对
    assert.equal(await verifySessionToken('v1.user-123.0', now), null);
  });

  it('rejects expired tokens', async () => {
    const now = Date.UTC(2026, 9, 10);
    const token = await createSessionToken('user-123', 0, now);
    const after31Days = now + 31 * 24 * 60 * 60 * 1000;

    assert.equal(await verifySessionToken(token, after31Days), null);
  });

  it('rejects malformed numeric fields', async () => {
    const now = Date.UTC(2026, 9, 10);
    const token = await createSessionToken('user-123', 0, now);
    const parts = token.split('.');
    parts[2] = 'not-a-number';
    assert.equal(await verifySessionToken(parts.join('.'), now), null);
  });
});
