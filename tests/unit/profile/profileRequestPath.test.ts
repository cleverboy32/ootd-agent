import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { profileRequestPath } from '@/lib/api/profile';

describe('profileRequestPath', () => {
  it('登录用户的缓存地址带上用户 id', () => {
    assert.equal(profileRequestPath('user-a'), '/api/profile?u=user-a');
    assert.notEqual(profileRequestPath('user-a'), profileRequestPath('user-b'));
  });

  it('没有登录用户时用裸 /api/profile', () => {
    assert.equal(profileRequestPath(null), '/api/profile');
  });
});
