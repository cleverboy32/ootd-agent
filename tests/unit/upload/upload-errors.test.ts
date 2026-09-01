import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toUserFacingUploadError } from '@/lib/upload-errors';

describe('toUserFacingUploadError', () => {
  it('maps Prisma vector errors to a friendly message', () => {
    const raw =
      'Invalid `prisma.$executeRaw()` invocation:\n\nRaw query failed. Code: `22000`. Message: `expected 3072 dimensions, not 2048`';
    assert.equal(toUserFacingUploadError(raw), '保存失败，请稍后重试');
  });

  it('keeps already friendly rate-limit messages', () => {
    assert.equal(
      toUserFacingUploadError('AI 服务请求过于频繁，请稍后再试'),
      'AI 服务请求过于频繁，请稍后再试'
    );
  });

  it('falls back for long technical messages', () => {
    assert.equal(
      toUserFacingUploadError('Something went wrong with a very long technical stack trace that users should never see in the UI because it is not actionable'),
      '处理失败，请重试'
    );
  });
});
