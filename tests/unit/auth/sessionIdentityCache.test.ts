import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createSessionIdentityCache,
  type SessionIdentity,
} from '@/server/auth/sessionIdentityCache';

function setup(initial: Record<string, SessionIdentity>, ttlMs = 30_000, maxEntries = 100) {
  const db = new Map(Object.entries(initial));
  let clock = 0;
  let loads = 0;
  const cache = createSessionIdentityCache({
    ttlMs,
    maxEntries,
    now: () => clock,
    load: async (userId) => {
      loads += 1;
      return db.get(userId) ?? null;
    },
  });
  return {
    cache,
    db,
    advance: (ms: number) => {
      clock += ms;
    },
    loads: () => loads,
  };
}

const alice: SessionIdentity = {
  id: 'u1',
  username: 'alice',
  sessionVersion: 0,
  clientProfileId: 'p1',
  hasSecurityQuestions: false,
};

describe('createSessionIdentityCache', () => {
  it('serves repeated lookups from cache within the TTL', async () => {
    const t = setup({ u1: alice });
    const first = await t.cache.resolve('u1', 0);
    assert.equal(first.cacheHit, false);
    assert.deepEqual(first.identity, alice);
    const second = await t.cache.resolve('u1', 0);
    assert.equal(second.cacheHit, true);
    assert.deepEqual(second.identity, alice);
    assert.equal(t.loads(), 1);
  });

  it('reloads after the TTL expires', async () => {
    const t = setup({ u1: alice });
    await t.cache.resolve('u1', 0);
    t.advance(30_001);
    const again = await t.cache.resolve('u1', 0);
    assert.equal(again.cacheHit, false);
    assert.equal(t.loads(), 2);
  });

  it('accepts a renewed token whose version is newer than the cached one', async () => {
    const t = setup({ u1: alice });
    await t.cache.resolve('u1', 0);
    t.db.set('u1', { ...alice, sessionVersion: 1 });
    const next = await t.cache.resolve('u1', 1);
    assert.equal(next.identity?.sessionVersion, 1);
    assert.equal(next.cacheHit, false);
    assert.equal(t.loads(), 2);
  });

  it('rejects older tokens without hitting the store once a newer version is cached', async () => {
    const t = setup({ u1: alice });
    await t.cache.resolve('u1', 0);
    t.db.set('u1', { ...alice, sessionVersion: 1 });
    await t.cache.resolve('u1', 1);
    const stale = await t.cache.resolve('u1', 0);
    assert.equal(stale.identity, null);
    assert.equal(stale.cacheHit, true);
    assert.equal(t.loads(), 2);
  });

  it('revokes a stale token at most one TTL after the version bump', async () => {
    const t = setup({ u1: alice });
    await t.cache.resolve('u1', 0);
    t.db.set('u1', { ...alice, sessionVersion: 1 });
    // TTL 内旧 token 仍可能命中旧缓存版本（与既有语义一致）
    assert.deepEqual((await t.cache.resolve('u1', 0)).identity, alice);
    t.advance(30_001);
    assert.equal((await t.cache.resolve('u1', 0)).identity, null);
  });

  it('returns null for unknown users and does not cache the miss', async () => {
    const t = setup({});
    assert.equal((await t.cache.resolve('ghost', 0)).identity, null);
    assert.equal((await t.cache.resolve('ghost', 0)).identity, null);
    assert.equal(t.loads(), 2);
  });

  it('evicts the oldest entry beyond maxEntries', async () => {
    const t = setup(
      {
        u1: alice,
        u2: {
          id: 'u2',
          username: 'bob',
          sessionVersion: 0,
          clientProfileId: 'p2',
          hasSecurityQuestions: false,
        },
        u3: {
          id: 'u3',
          username: 'carol',
          sessionVersion: 0,
          clientProfileId: 'p3',
          hasSecurityQuestions: true,
        },
      },
      30_000,
      2
    );
    await t.cache.resolve('u1', 0);
    await t.cache.resolve('u2', 0);
    await t.cache.resolve('u3', 0);
    await t.cache.resolve('u1', 0);
    assert.equal(t.loads(), 4);
  });
});
