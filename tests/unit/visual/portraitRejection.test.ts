import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { portraitRejectionMessage } from '@/server/agents/visual/profile';

describe('portraitRejectionMessage', () => {
  it('explains which full-body requirement failed', () => {
    assert.match(portraitRejectionMessage('half_body'), /膝盖/);
    assert.match(portraitRejectionMessage('half_body'), /半身/);
    assert.match(portraitRejectionMessage('close_up'), /大头/);
    assert.match(portraitRejectionMessage('coat_covers_body'), /长大衣/);
    assert.match(portraitRejectionMessage(''), /膝盖/);
    assert.match(portraitRejectionMessage('unknown'), /膝盖/);
  });
});
