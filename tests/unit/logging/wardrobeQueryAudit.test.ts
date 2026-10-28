import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WardrobeQueryAuditEntry } from '@/server/logging/wardrobeQuery';
import type { StylistOutfitAuditEntry } from '@/server/logging/stylistOutfit';

describe('wardrobe / outfit audit entry shape', () => {
  it('queries 条目含 kind 与 queries，不含 RAG 命中字段', () => {
    const entry: WardrobeQueryAuditEntry = {
      timestamp: '2026-01-01T00:00:00.000Z',
      kind: 'queries',
      conversationId: 'c1',
      messageId: 'm1',
      userMessage: '今天穿什么',
      occasion: '日常',
      specialRequests: '',
      stylePreference: '',
      skillNames: ['style-korean'],
      queries: [{ slot: 'top', query: '短上衣' }],
    };
    assert.equal(entry.kind, 'queries');
    assert.equal(entry.queries.length, 1);
    assert.equal('perQueryResults' in entry, false);
    assert.equal('hits' in entry, false);
  });

  it('query_critic 条目可带同一 messageId 与 approved', () => {
    const entry: WardrobeQueryAuditEntry = {
      timestamp: '2026-01-01T00:00:01.000Z',
      kind: 'query_critic',
      messageId: 'm1',
      queries: [{ slot: 'shoes', query: '运动鞋' }],
      approved: false,
      reason: '正式场合不应默认运动鞋',
    };
    assert.equal(entry.kind, 'query_critic');
    assert.equal(entry.approved, false);
    assert.ok(entry.reason);
  });

  it('outfit audit 条目含 approved / reason / outfitCount', () => {
    const entry: StylistOutfitAuditEntry = {
      timestamp: '2026-01-01T00:00:02.000Z',
      messageId: 'm1',
      outfitCount: 2,
      approved: true,
      reason: '场合与技能相符',
      outfitNotes: [{ id: 'outfit_1', ok: true, note: 'ok' }],
    };
    assert.equal(entry.outfitCount, 2);
    assert.equal(entry.approved, true);
    assert.equal(entry.outfitNotes?.[0].id, 'outfit_1');
  });
});
