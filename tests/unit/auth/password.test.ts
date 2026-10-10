import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hashSecret,
  validatePasswordStrength,
  verifySecret,
} from '@/server/auth/password';

describe('password hashing', () => {
  it('roundtrips a correct secret and rejects a wrong one', async () => {
    const stored = await hashSecret('Passw0rd!');

    assert.equal(await verifySecret('Passw0rd!', stored), true);
    assert.equal(await verifySecret('passw0rd!', stored), false);
    assert.equal(await verifySecret('Passw0rd?', stored), false);
  });

  it('produces unique salts for identical inputs', async () => {
    const first = await hashSecret('same-secret-1');
    const second = await hashSecret('same-secret-1');

    assert.notEqual(first, second);
    assert.equal(await verifySecret('same-secret-1', first), true);
    assert.equal(await verifySecret('same-secret-1', second), true);
  });

  it('rejects malformed or tampered hashes', async () => {
    const stored = await hashSecret('abc12345');
    const tampered = `${stored.slice(0, -4)}AAAA`;

    assert.equal(await verifySecret('abc12345', 'not-a-hash'), false);
    assert.equal(await verifySecret('abc12345', 'scrypt:1:2:3'), false);
    assert.equal(await verifySecret('abc12345', 'scrypt:x:y:z:AA==:BB=='), false);
    assert.equal(await verifySecret('abc12345', tampered), false);
  });
});

describe('validatePasswordStrength', () => {
  it('enforces length and letter+digit rules', () => {
    assert.equal(validatePasswordStrength('abc12345'), null);
    assert.match(validatePasswordStrength('a1') ?? '', /至少 8 位/);
    assert.match(validatePasswordStrength('abcdefgh') ?? '', /字母和数字/);
    assert.match(validatePasswordStrength('12345678') ?? '', /字母和数字/);
    assert.match(validatePasswordStrength(`a1${'x'.repeat(80)}`) ?? '', /最长 72 位/);
  });
});
