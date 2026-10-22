import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeGatekeeperIntent } from '@/server/agents/intent';
import {
  COPYWRITER_SYSTEM_INSTRUCTION,
  selectCopywriterSkillName,
} from '@/server/agents/copywriter/prompts';
import { buildSkillBlocks } from '@/server/skills/loadSkill';

describe('selectCopywriterSkillName', () => {
  function block(
    intent?: Parameters<typeof normalizeGatekeeperIntent>[0],
    revisionNoItemChange?: boolean
  ) {
    const name = selectCopywriterSkillName(
      intent ? normalizeGatekeeperIntent(intent) : undefined,
      revisionNoItemChange
    );
    return buildSkillBlocks([name]);
  }

  it('四种场景各只注入一份话术', () => {
    const outfit = block({ request_type: 'wardrobe_outfit' });
    assert.match(outfit, /【技能 reply-outfit】/);
    assert.match(outfit, /我为你准备了 N 套/);
    assert.doesNotMatch(outfit, /reply-revision|reply-advice/);

    const revision = block({ request_type: 'feedback_revision', special_requests: '换鞋' });
    assert.match(revision, /【技能 reply-revision】/);
    assert.match(revision, /还要再调哪里吗/);
    assert.doesNotMatch(revision, /reply-outfit|reply-advice|unchanged/);

    const unchanged = block(
      { request_type: 'feedback_revision', special_requests: '按这个天气看看' },
      true
    );
    assert.match(unchanged, /【技能 reply-revision-unchanged】/);
    assert.match(unchanged, /无换品微调/);
    assert.doesNotMatch(unchanged, /reply-outfit|reply-advice-continuation/);

    const advice = block({
      request_type: 'wardrobe_outfit',
      special_requests: '按高级感大地色系公式搭配',
    });
    assert.match(advice, /【技能 reply-advice-continuation】/);
    assert.match(advice, /建议延续模式/);
    assert.doesNotMatch(advice, /reply-outfit|reply-revision/);
  });

  it('主提示词不再包含全新方案开场骨架', () => {
    assert.doesNotMatch(COPYWRITER_SYSTEM_INSTRUCTION, /我为你准备了 N 套/);
    assert.match(COPYWRITER_SYSTEM_INSTRUCTION, /\{\{W:物品ID\}\}/);
    assert.match(COPYWRITER_SYSTEM_INSTRUCTION, /\{\{IMG:方案ID\}\}/);
  });
});
