import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { PRODUCT_HOME } from '@/lib/pageGate';
import { SESSION_COOKIE_NAME, createSessionToken } from '@/server/auth/session';

const originalEnv = {
  USER_SESSION_SECRET: process.env.USER_SESSION_SECRET,
};

before(() => {
  process.env.USER_SESSION_SECRET = 'test-user-session-secret-32-chars!';
});

after(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('proxy login gate', () => {
  it('rejects requests without a session cookie', async () => {
    const res = await proxy(new NextRequest('http://localhost/api/conversations'));
    assert.equal(res.status, 401);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'UNAUTHENTICATED');
  });

  it('rejects requests with a tampered session cookie', async () => {
    const res = await proxy(
      new NextRequest('http://localhost/api/wardrobe', {
        headers: { cookie: 'ootd-session=v1.fake.0.9999999999.badsignature' },
      })
    );
    assert.equal(res.status, 401);
  });

  it('passes /api/auth/* through without a session', async () => {
    const res = await proxy(new NextRequest('http://localhost/api/auth/session'));
    assert.equal(res.status, 200);
  });

  it('lets guests stay on marketing /', async () => {
    const res = await proxy(new NextRequest('http://localhost/'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('location'), null);
  });

  it('redirects signed-in visits on / to product home', async () => {
    const token = await createSessionToken('user-gate', 0);
    const res = await proxy(
      new NextRequest('http://localhost/', {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      })
    );
    assert.equal(res.status, 307);
    assert.equal(new URL(res.headers.get('location') ?? '').pathname, PRODUCT_HOME);
  });
});
