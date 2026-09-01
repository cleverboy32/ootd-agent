import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import {
  ACCESS_COOKIE_NAME,
  createAccessSessionToken,
  isAccessCodeValid,
  isPublicReadRequest,
  verifyAccessSessionToken,
} from '@/server/auth/access';
import { POST as verifyAccess } from '@/app/api/access/verify/route';
import { proxy } from '@/proxy';

const originalEnv = {
  ACCESS_CODE: process.env.ACCESS_CODE,
  ACCESS_SESSION_SECRET: process.env.ACCESS_SESSION_SECRET,
  OWNER_CLIENT_ID: process.env.OWNER_CLIENT_ID,
};

before(() => {
  process.env.ACCESS_CODE = 'correct-code';
  process.env.ACCESS_SESSION_SECRET = 'test-secret-with-at-least-32-characters';
  process.env.OWNER_CLIENT_ID = 'owner-client-id';
});

after(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('access session', () => {
  it('accepts only the configured access code', () => {
    assert.equal(isAccessCodeValid('correct-code'), true);
    assert.equal(isAccessCodeValid('wrong-code'), false);
  });

  it('signs, verifies, expires, and rejects tampered session tokens', async () => {
    const now = Date.UTC(2026, 7, 31);
    const token = await createAccessSessionToken(now);

    assert.equal(await verifyAccessSessionToken(token, now), true);
    assert.equal(await verifyAccessSessionToken(`${token}x`, now), false);
    assert.equal(
      await verifyAccessSessionToken(token, now + 31 * 24 * 60 * 60 * 1000),
      false
    );
  });

  it('sets an HttpOnly cookie for a correct code and rejects a wrong code', async () => {
    const accepted = await verifyAccess(
      new NextRequest('http://localhost/api/access/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'correct-code' }),
      })
    );
    assert.equal(accepted.status, 200);
    assert.match(accepted.headers.get('set-cookie') ?? '', new RegExp(ACCESS_COOKIE_NAME));
    assert.match(accepted.headers.get('set-cookie') ?? '', /HttpOnly/i);

    const rejected = await verifyAccess(
      new NextRequest('http://localhost/api/access/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'wrong-code' }),
      })
    );
    assert.equal(rejected.status, 401);
  });
});

describe('single-user API policy', () => {
  it('allows only the explicit anonymous GET routes', () => {
    assert.equal(isPublicReadRequest('/api/conversations', 'GET'), true);
    assert.equal(
      isPublicReadRequest('/api/conversations/conversation-1/messages', 'GET'),
      true
    );
    assert.equal(isPublicReadRequest('/api/wardrobe/item-1', 'GET'), true);
    assert.equal(isPublicReadRequest('/api/clients/untrusted-id', 'GET'), true);
    assert.equal(isPublicReadRequest('/api/upload', 'POST'), false);
    assert.equal(isPublicReadRequest('/api/wardrobe', 'POST'), false);
  });

  it('forces the owner id on public reads and blocks anonymous writes', async () => {
    const publicResponse = await proxy(
      new NextRequest('http://localhost/api/conversations', {
        headers: { 'x-client-id': 'attacker-controlled-id' },
      })
    );
    assert.equal(publicResponse.status, 200);
    assert.equal(
      publicResponse.headers.get('x-middleware-request-x-client-id'),
      'owner-client-id'
    );

    const blockedResponse = await proxy(
      new NextRequest('http://localhost/api/conversations', { method: 'POST' })
    );
    assert.equal(blockedResponse.status, 403);
  });

  it('allows a signed session to reach protected routes', async () => {
    const token = await createAccessSessionToken();
    const response = await proxy(
      new NextRequest('http://localhost/api/generate-with-image', {
        method: 'POST',
        headers: { cookie: `${ACCESS_COOKIE_NAME}=${token}` },
      })
    );
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('x-middleware-request-x-client-id'),
      'owner-client-id'
    );
  });
});
