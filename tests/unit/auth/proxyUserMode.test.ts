import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import { getAuthMode, proxy } from '@/proxy';

const originalEnv = {
  AUTH_MODE: process.env.AUTH_MODE,
  USER_SESSION_SECRET: process.env.USER_SESSION_SECRET,
};

before(() => {
  process.env.AUTH_MODE = 'user';
  process.env.USER_SESSION_SECRET = 'test-user-session-secret-32-chars!';
});

after(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('getAuthMode', () => {
  it('defaults to access and switches on AUTH_MODE=user', () => {
    delete process.env.AUTH_MODE;
    assert.equal(getAuthMode(), 'access');
    process.env.AUTH_MODE = 'user';
    assert.equal(getAuthMode(), 'user');
    process.env.AUTH_MODE = 'anything-else';
    assert.equal(getAuthMode(), 'access');
    process.env.AUTH_MODE = 'user';
  });
});

describe('proxy in user mode', () => {
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
});
