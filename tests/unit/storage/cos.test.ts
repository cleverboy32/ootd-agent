import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  buildCosObjectKey,
  createCosPutUrl,
  getCosPublicUrl,
} from '@/server/services/cos';
import { isClientOwnedUploadUrl } from '@/server/utils/profileMetadata';

const envNames = [
  'COS_SECRET_ID',
  'COS_SECRET_KEY',
  'COS_BUCKET',
  'COS_REGION',
  'COS_KEY_PREFIX',
  'COS_PUBLIC_BASE_URL',
] as const;
const originalEnv = Object.fromEntries(
  envNames.map((name) => [name, process.env[name]])
) as Record<(typeof envNames)[number], string | undefined>;

before(() => {
  process.env.COS_SECRET_ID = 'test-secret-id';
  process.env.COS_SECRET_KEY = 'test-secret-key';
  process.env.COS_BUCKET = 'ootd-1234567890';
  process.env.COS_REGION = 'ap-nanjing';
  process.env.COS_KEY_PREFIX = 'shows/';
  process.env.COS_PUBLIC_BASE_URL =
    'https://ootd-1234567890.cos.ap-nanjing.myqcloud.com';
});

after(() => {
  for (const name of envNames) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('COS storage', () => {
  it('builds prefixed object keys and public URLs', () => {
    const key = buildCosObjectKey('/user-uploads/client-1/自拍.png');
    assert.equal(key, 'shows/user-uploads/client-1/自拍.png');
    assert.equal(
      getCosPublicUrl(key),
      'https://ootd-1234567890.cos.ap-nanjing.myqcloud.com/shows/user-uploads/client-1/%E8%87%AA%E6%8B%8D.png'
    );
  });

  it('creates a signed HTTPS PUT URL without exposing the secret key', () => {
    const url = createCosPutUrl(
      'shows/user-uploads/client-1/photo.jpg',
      'image/jpeg'
    );
    assert.match(url, /^https:\/\/ootd-1234567890\.cos\.ap-nanjing\.myqcloud\.com\//);
    assert.match(url, /q-sign-algorithm=/);
    assert.doesNotMatch(url, /test-secret-key/);
  });

  it('accepts only upload URLs owned by the requested client', () => {
    const owned =
      'https://ootd-1234567890.cos.ap-nanjing.myqcloud.com/shows/user-uploads/client-1/photo.jpg';

    assert.equal(isClientOwnedUploadUrl(owned, 'client-1'), true);
    assert.equal(isClientOwnedUploadUrl(owned, 'client-2'), false);
    assert.equal(
      isClientOwnedUploadUrl(
        'https://attacker.example/shows/user-uploads/client-1/photo.jpg',
        'client-1'
      ),
      false
    );
    assert.equal(
      isClientOwnedUploadUrl(
        'http://ootd-1234567890.cos.ap-nanjing.myqcloud.com/shows/user-uploads/client-1/photo.jpg',
        'client-1'
      ),
      false
    );
  });
});
