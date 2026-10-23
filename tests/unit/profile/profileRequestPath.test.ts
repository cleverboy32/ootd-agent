import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { profileRequestPath } from '@/lib/api/profile';

describe('profileRequestPath', () => {
  it('登录用户的缓存地址带上用户 id', () => {
    assert.equal(
      profileRequestPath('owner-1', 'user-a'),
      '/api/clients/owner-1?u=user-a'
    );
    assert.notEqual(
      profileRequestPath('owner-1', 'user-a'),
      profileRequestPath('owner-1', 'user-b')
    );
  });

  it('没有登录用户时仍用 owner 地址', () => {
    assert.equal(profileRequestPath('owner-1', null), '/api/clients/owner-1');
  });
});
