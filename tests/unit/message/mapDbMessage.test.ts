import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapDbMessageToClient } from '@/lib/mappers/message';

describe('mapDbMessageToClient', () => {
  it('maps DB assistant role to client ai', () => {
    const msg = mapDbMessageToClient({
      id: 'm1',
      role: 'assistant',
      status: 'failed',
      content: [{ type: 'text', content: '' }],
      createdAt: new Date('2026-10-30T09:36:56.796Z'),
    });
    assert.equal(msg.role, 'ai');
    assert.equal(msg.status, 'failed');
    assert.deepEqual(msg.content, []);
  });

  it('keeps user role', () => {
    const msg = mapDbMessageToClient({
      id: 'm2',
      role: 'user',
      status: 'completed',
      content: [{ type: 'text', content: '你好' }],
    });
    assert.equal(msg.role, 'user');
    assert.equal(msg.content[0]?.content, '你好');
  });
});
