import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  generateRecoveryCode,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  normalizeSecurityAnswer,
  normalizeUsername,
  validateSecurityQuestions,
  validateUsername,
} from '@/server/auth/credentials';

describe('username', () => {
  it('normalizes case and surrounding whitespace', () => {
    assert.equal(normalizeUsername('  Alice_01 '), 'alice_01');
  });

  it('validates allowed shape', () => {
    assert.equal(validateUsername('alice_01'), null);
    assert.equal(validateUsername('a-b_c-9'), null);
    assert.match(validateUsername('ab') ?? '', /3~20/);
    assert.match(validateUsername(`a${'b'.repeat(20)}`) ?? '', /3~20/);
    assert.match(validateUsername('含中文') ?? '', /3~20/);
    assert.match(validateUsername('has space') ?? '', /3~20/);
  });
});

describe('security answer normalization', () => {
  it('folds case, whitespace and full-width characters', () => {
    assert.equal(normalizeSecurityAnswer('  阳光小学 '), '阳光小学');
    assert.equal(normalizeSecurityAnswer('Ａｂｃ　１２３'), 'abc 123');
    assert.equal(normalizeSecurityAnswer('New   York'), 'new york');
    assert.equal(normalizeSecurityAnswer('ＷＯＲＤ'), 'word');
  });
});

describe('validateSecurityQuestions', () => {
  it('requires 2~3 unique questions with answers', () => {
    assert.equal(
      validateSecurityQuestions([
        { question: '我的小学名字是什么', answer: '阳光小学' },
        { question: '我出生的城市是哪里', answer: '成都' },
      ]),
      null
    );
    assert.match(
      validateSecurityQuestions([{ question: '我的小学名字是什么', answer: '阳光小学' }]) ?? '',
      /2~3/
    );
    assert.match(
      validateSecurityQuestions([
        { question: '我的小学名字是什么', answer: 'a' },
        { question: '我的小学名字是什么', answer: 'b' },
      ]) ?? '',
      /不能重复/
    );
    assert.match(
      validateSecurityQuestions([
        { question: '短', answer: 'a' },
        { question: '我出生的城市是哪里', answer: 'b' },
      ]) ?? '',
      /4~50/
    );
    assert.match(
      validateSecurityQuestions([
        { question: '我的小学名字是什么', answer: '   ' },
        { question: '我出生的城市是哪里', answer: 'b' },
      ]) ?? '',
      /1~50/
    );
  });
});

describe('recovery codes', () => {
  it('generates XXXX-XXXX-XXXX codes in Crockford base32', () => {
    const code = generateRecoveryCode();
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){2}$/);
  });

  it('generates a batch of unique codes', () => {
    const codes = generateRecoveryCodes(8);
    assert.equal(codes.length, 8);
    assert.equal(new Set(codes).size, 8);
  });

  it('normalizes user input regardless of dashes/case/spacing', () => {
    assert.equal(normalizeRecoveryCode('abcd-ef12-3456'), 'ABCDEF123456');
    assert.equal(normalizeRecoveryCode(' ABCD EF12 3456 '), 'ABCDEF123456');
  });
});
