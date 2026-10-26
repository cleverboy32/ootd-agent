import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isDeepseekPeak,
  priceImageCostCny,
  priceModelUsage,
} from '@/server/config/modelPricing';
import { readChatUsage, readImageUsage } from '@/server/logging/modelUsage';
import { RequestAuditKind, RequestAuditOutcome, RequestTrace } from '@/server/logging/request';
const peakWednesday = new Date('2026-10-21T02:00:00.000Z');
const offPeakSaturday = new Date('2026-10-24T02:00:00.000Z');
const lunchWednesday = new Date('2026-10-21T05:00:00.000Z');
const mondayNine = new Date('2026-10-19T01:00:00.000Z');
const mondayNoon = new Date('2026-10-19T04:00:00.000Z');
const mondaySix = new Date('2026-10-19T10:00:00.000Z');

describe('isDeepseekPeak', () => {
  it('uses Beijing weekday windows and treats weekends as off-peak', () => {
    assert.equal(isDeepseekPeak(peakWednesday), true);
    assert.equal(isDeepseekPeak(mondayNine), true);
    assert.equal(isDeepseekPeak(lunchWednesday), false);
    assert.equal(isDeepseekPeak(mondayNoon), false);
    assert.equal(isDeepseekPeak(mondaySix), false);
    assert.equal(isDeepseekPeak(offPeakSaturday), false);
  });
});

describe('priceModelUsage', () => {
  it('prices cache hit, cache miss, and output separately', () => {
    const offPeak = priceModelUsage(
      {
        kind: 'chat',
        model: 'deepseek-flash',
        cacheHitTokens: 100,
        cacheMissTokens: 100,
        completionTokens: 100,
      },
      offPeakSaturday
    );
    assert.equal(offPeak.costCny, 0.000502);

    const peak = priceModelUsage(
      {
        kind: 'chat',
        model: 'deepseek-v4-pro',
        cacheHitTokens: 1_000_000,
        cacheMissTokens: 1_000_000,
        completionTokens: 1_000_000,
      },
      peakWednesday
    );
    assert.equal(peak.costCny, 36.3);
  });

  it('bills the retired vision name at the flash rate', () => {
    const priced = priceModelUsage(
      {
        kind: 'chat',
        model: 'deepseek-v4-flash-vision-exp',
        cacheMissTokens: 1_000_000,
      },
      offPeakSaturday
    );
    assert.equal(priced.costCny, 1);
  });

  it('leaves unknown models unpriced', () => {
    const priced = priceModelUsage(
      {
        kind: 'chat',
        model: 'gemini-2.5-pro',
        cacheMissTokens: 1_000_000,
        completionTokens: 1_000,
      },
      peakWednesday
    );
    assert.equal(priced.costCny, null);
  });

  it('prices images by successful count and ignores output tokens', () => {
    assert.equal(priceImageCostCny(2, 0.2), 0.4);
    const priced = priceModelUsage({
      kind: 'image',
      model: 'ep-unknown',
      generatedImages: 2,
      imageOutputTokens: 99_999,
    });
    assert.equal(priced.costCny, null);
  });

  it('does not treat a missing usage payload as free', () => {
    const priced = priceModelUsage(
      { kind: 'chat', model: 'deepseek-flash', usageMissing: true },
      offPeakSaturday
    );
    assert.equal(priced.costCny, null);
  });
});

describe('readChatUsage', () => {
  it('keeps DeepSeek cache hit and miss apart', () => {
    const usage = readChatUsage({
      prompt_tokens: 30,
      prompt_cache_hit_tokens: 10,
      prompt_cache_miss_tokens: 20,
      completion_tokens: 5,
    });
    assert.equal(usage.cacheHitTokens, 10);
    assert.equal(usage.cacheMissTokens, 20);
    assert.equal(usage.completionTokens, 5);
  });
});

describe('readImageUsage', () => {
  it('keeps output tokens off the billing count', () => {
    const usage = readImageUsage({ generated_images: 1, output_tokens: 16384 }, 1);
    assert.equal(usage.generatedImages, 1);
    assert.equal(usage.imageOutputTokens, 16384);
  });
});

describe('RequestTrace usage rollup', () => {
  it('sums priced calls and counts calls that have no price', () => {
    const trace = new RequestTrace({
      kind: RequestAuditKind.Generate,
      conversationId: 'c1',
      messageId: 'm1',
    });

    trace.addUsage({
      cacheHitTokens: 10,
      cacheMissTokens: 20,
      completionTokens: 5,
      embeddingTokens: 0,
      generatedImages: 0,
      costCny: 0.000502,
    });
    trace.addUsage({
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      completionTokens: 0,
      embeddingTokens: 0,
      generatedImages: 2,
      costCny: null,
    });

    const entry = trace.finalize({ outcome: RequestAuditOutcome.Completed });
    assert.equal(entry.summary.usage?.calls, 2);
    assert.equal(entry.summary.usage?.cacheMissTokens, 20);
    assert.equal(entry.summary.usage?.generatedImages, 2);
    assert.equal(entry.summary.usage?.pricedCostCny, 0.000502);
    assert.equal(entry.summary.usage?.unpricedCalls, 1);
  });
});
