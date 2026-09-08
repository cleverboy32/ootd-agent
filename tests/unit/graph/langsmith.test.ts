import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPipelineInvokeConfig,
  isLangSmithTracingEnabled,
} from '@/app/api/generate-with-image/graph/langsmith';
import type { OutfitRuntime } from '@/app/api/generate-with-image/graph/state';

function stubRuntime(overrides: Partial<OutfitRuntime> = {}): OutfitRuntime {
  return {
    controller: {} as ReadableStreamDefaultController,
    imageMap: new Map(),
    failedImageIds: new Set(),
    ragCache: new Map(),
    initialParts: [],
    conversationId: 'conv-1',
    clientId: 'client-1',
    profileLocationPromise: Promise.resolve(undefined),
    trace: {} as OutfitRuntime['trace'],
    appendText: () => undefined,
    getAccumulated: () => '',
    setMessageId: () => undefined,
    getMessageId: () => 'msg-1',
    setStylistCache: () => undefined,
    getStylistCache: () => null,
    setActiveStylist: () => undefined,
    getActiveStylist: () => null,
    setWardrobeCandidates: () => undefined,
    getWardrobeCandidates: () => null,
    setActiveIntent: () => undefined,
    getActiveIntent: () => undefined,
    ...overrides,
  };
}

describe('langsmith helpers', () => {
  it('isLangSmithTracingEnabled reads LANGSMITH_TRACING', () => {
    const prev = process.env.LANGSMITH_TRACING;
    process.env.LANGSMITH_TRACING = 'true';
    assert.equal(isLangSmithTracingEnabled(), true);
    process.env.LANGSMITH_TRACING = 'false';
    assert.equal(isLangSmithTracingEnabled(), false);
    if (prev === undefined) delete process.env.LANGSMITH_TRACING;
    else process.env.LANGSMITH_TRACING = prev;
  });

  it('buildPipelineInvokeConfig keeps runtime and metadata', () => {
    const runtime = stubRuntime();
    const cfg = buildPipelineInvokeConfig({
      runtime,
      pipeline: 'outfit_fresh',
      conversationId: 'conv-1',
      clientId: 'client-1',
    });
    assert.equal(cfg.runName, 'outfit_fresh');
    assert.deepEqual(cfg.tags, ['ootd-agent', 'outfit-pipeline', 'outfit_fresh']);
    assert.equal((cfg.configurable as { runtime: OutfitRuntime }).runtime, runtime);
    assert.equal(cfg.metadata?.conversationId, 'conv-1');
    assert.equal(cfg.metadata?.messageId, 'msg-1');
  });
});
