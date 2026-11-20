import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapDbMessageToClient } from '@/lib/mappers/message';

describe('mapDbMessageToClient cancelled status', () => {
  it('preserves cancelled status from DB', () => {
    const msg = mapDbMessageToClient({
      id: 'm1',
      role: 'assistant',
      status: 'cancelled',
      content: [{ type: 'text', content: '半成品' }],
      timestamp: new Date('2026-01-01T00:00:00Z'),
    });
    assert.equal(msg.status, 'cancelled');
    assert.equal(msg.role, 'ai');
    assert.equal(msg.content[0]?.content, '半成品');
  });
});
