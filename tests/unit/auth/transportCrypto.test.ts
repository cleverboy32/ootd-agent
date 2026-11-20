import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { sealSecret } from '@/lib/auth/sealSecret';
import {
  getTransportPublicKey,
  resetTransportCryptoForTests,
  unsealSecret,
} from '@/server/auth/transportCrypto';

const previousKey = process.env.AUTH_TRANSPORT_PRIVATE_KEY;

function useFreshKey(): void {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });
  process.env.AUTH_TRANSPORT_PRIVATE_KEY = Buffer.from(pkcs8).toString('base64');
  resetTransportCryptoForTests();
}

after(() => {
  if (previousKey === undefined) delete process.env.AUTH_TRANSPORT_PRIVATE_KEY;
  else process.env.AUTH_TRANSPORT_PRIVATE_KEY = previousKey;
  resetTransportCryptoForTests();
});

describe('auth transport crypto', () => {
  it('seals a password so the request body is not the plaintext', async () => {
    useFreshKey();
    const pub = getTransportPublicKey();
    const sealed = await sealSecret('abc12345', pub);

    assert.equal(sealed.includes('abc12345'), false);
    assert.match(sealed, /^enc1\.[0-9a-f]{16}\.[A-Za-z0-9+/=]+$/);
    const opened = unsealSecret(sealed);
    assert.equal(opened.ok, true);
    if (opened.ok) assert.equal(opened.value, 'abc12345');
  });

  it('passes through values that are not transport envelopes', () => {
    const opened = unsealSecret('plain-password');
    assert.deepEqual(opened, { ok: true, value: 'plain-password' });
  });

  it('rejects a ciphertext sealed for a different key', async () => {
    useFreshKey();
    const pub = getTransportPublicKey();
    const sealed = await sealSecret('abc12345', pub);

    useFreshKey();
    const opened = unsealSecret(sealed);
    assert.equal(opened.ok, false);
    if (!opened.ok) assert.equal(opened.code, 'TRANSPORT_KEY_MISMATCH');
  });

  it('rejects a tampered ciphertext', async () => {
    useFreshKey();
    const pub = getTransportPublicKey();
    const sealed = await sealSecret('abc12345', pub);
    const [prefix, kid, b64] = sealed.split('.');
    const tampered = `${prefix}.${kid}.${b64.slice(0, -4)}AAAA`;

    const opened = unsealSecret(tampered);
    assert.equal(opened.ok, false);
    if (!opened.ok) assert.equal(opened.code, 'TRANSPORT_INVALID');
  });
});
