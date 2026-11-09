import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PRODUCT_HOME, resolvePageGate } from '@/lib/pageGate';

describe('resolvePageGate', () => {
  it('keeps guests on the marketing page and login', () => {
    assert.deepEqual(resolvePageGate({ pathname: '/', hasSession: false }), { type: 'next' });
    assert.deepEqual(resolvePageGate({ pathname: '/login', hasSession: false }), { type: 'next' });
    assert.deepEqual(resolvePageGate({ pathname: '/login/', hasSession: false }), { type: 'next' });
  });

  it('sends guests on product pages to the marketing landing', () => {
    assert.deepEqual(resolvePageGate({ pathname: '/home', hasSession: false }), {
      type: 'redirect',
      location: '/',
    });
    assert.deepEqual(
      resolvePageGate({ pathname: '/wardrobe', search: '?tab=1', hasSession: false }),
      { type: 'redirect', location: '/' }
    );
    assert.deepEqual(resolvePageGate({ pathname: '/profile', hasSession: false }), {
      type: 'redirect',
      location: '/',
    });
    assert.deepEqual(resolvePageGate({ pathname: '/collect', hasSession: false }), {
      type: 'redirect',
      location: '/',
    });
    assert.deepEqual(resolvePageGate({ pathname: '/settings/credits', hasSession: false }), {
      type: 'redirect',
      location: '/',
    });
  });

  it('sends a signed-in visit to / over to the product home and keeps deep-link query', () => {
    assert.deepEqual(resolvePageGate({ pathname: '/', hasSession: true }), {
      type: 'redirect',
      location: PRODUCT_HOME,
    });
    assert.deepEqual(
      resolvePageGate({ pathname: '/', search: '?c=abc&m=1&o=2', hasSession: true }),
      { type: 'redirect', location: '/home?c=abc&m=1&o=2' }
    );
  });

  it('sends a signed-in visit to /login toward a safe redirect, defaulting to /home', () => {
    assert.deepEqual(resolvePageGate({ pathname: '/login', hasSession: true }), {
      type: 'redirect',
      location: PRODUCT_HOME,
    });
    assert.deepEqual(
      resolvePageGate({
        pathname: '/login',
        search: '?redirect=%2Fwardrobe',
        hasSession: true,
      }),
      { type: 'redirect', location: '/wardrobe' }
    );
    assert.deepEqual(
      resolvePageGate({
        pathname: '/login',
        search: '?redirect=//evil.example',
        hasSession: true,
      }),
      { type: 'redirect', location: PRODUCT_HOME }
    );
    assert.deepEqual(
      resolvePageGate({
        pathname: '/login',
        search: '?redirect=%2F',
        hasSession: true,
      }),
      { type: 'redirect', location: PRODUCT_HOME }
    );
  });

  it('lets a signed-in user stay on product pages and ignores api paths', () => {
    assert.deepEqual(resolvePageGate({ pathname: '/home', hasSession: true }), { type: 'next' });
    assert.deepEqual(resolvePageGate({ pathname: '/api/auth/session', hasSession: false }), {
      type: 'next',
    });
  });
});
