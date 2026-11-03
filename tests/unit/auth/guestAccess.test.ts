import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isGuestAllowedPath, loginHref } from '@/lib/guestAccess';

describe('isGuestAllowedPath', () => {
  it('allows home and login', () => {
    assert.equal(isGuestAllowedPath('/'), true);
    assert.equal(isGuestAllowedPath('/login'), true);
    assert.equal(isGuestAllowedPath('/login/'), true);
  });

  it('rejects app pages that require session', () => {
    assert.equal(isGuestAllowedPath('/wardrobe'), false);
    assert.equal(isGuestAllowedPath('/profile'), false);
    assert.equal(isGuestAllowedPath('/settings/credits'), false);
    assert.equal(isGuestAllowedPath('/collect'), false);
  });
});

describe('loginHref', () => {
  it('encodes redirect query', () => {
    assert.equal(loginHref('/'), '/login?redirect=%2F');
    assert.equal(loginHref('/wardrobe'), '/login?redirect=%2Fwardrobe');
  });
});
