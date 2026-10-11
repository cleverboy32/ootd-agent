import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { stripBasePath, withBasePath } from '@/lib/utils';

describe('stripBasePath', () => {
  const original = process.env.NEXT_PUBLIC_BASE_PATH;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/ootd';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = original;
  });

  it('maps the basePath root to /', () => {
    assert.equal(stripBasePath('/ootd'), '/');
    assert.equal(stripBasePath('/ootd/'), '/');
  });

  it('strips the basePath from nested paths', () => {
    assert.equal(stripBasePath('/ootd/settings/security'), '/settings/security');
  });

  it('leaves paths that merely share the prefix untouched', () => {
    assert.equal(stripBasePath('/ootdx/page'), '/ootdx/page');
    assert.equal(stripBasePath('/login'), '/login');
  });

  it('is the inverse of withBasePath', () => {
    assert.equal(stripBasePath(withBasePath('/wardrobe')), '/wardrobe');
  });

  it('is a no-op without a configured basePath', () => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    assert.equal(stripBasePath('/ootd/wardrobe'), '/ootd/wardrobe');
  });
});
