import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readCredential, vendorPrefix } from '@/server/services/llm/credentials';
import { resolveChatTemperature } from '@/server/services/llm/client';

describe('vendorPrefix', () => {
  it('uppercases vendor names for env lookup', () => {
    assert.equal(vendorPrefix('kimi'), 'KIMI');
    assert.equal(vendorPrefix('bytedance'), 'BYTEDANCE');
  });
});

describe('readCredential', () => {
  it('reads KIMI_API_KEY when LLM_VENDOR=kimi', () => {
    const prevVendor = process.env.LLM_VENDOR;
    const prevKey = process.env.KIMI_API_KEY;
    process.env.LLM_VENDOR = 'kimi';
    process.env.KIMI_API_KEY = 'sk-test';
    try {
      const cred = readCredential('chat');
      assert.equal(cred.apiKey, 'sk-test');
      assert.equal(cred.baseURL, 'https://api.moonshot.cn/v1');
    } finally {
      process.env.LLM_VENDOR = prevVendor;
      process.env.KIMI_API_KEY = prevKey;
    }
  });
});

describe('resolveChatTemperature', () => {
  it('uses the only temperature accepted by Kimi models', () => {
    assert.equal(resolveChatTemperature('kimi-k2.5', 0), 1);
    assert.equal(resolveChatTemperature('kimi-k2.5', 0.7), 1);
  });

  it('keeps requested temperature for other models', () => {
    const previous = process.env.LLM_VENDOR;
    delete process.env.LLM_VENDOR;
    try {
      assert.equal(resolveChatTemperature('gpt-4o-mini', 0.3), 0.3);
    } finally {
      process.env.LLM_VENDOR = previous;
    }
  });
});
