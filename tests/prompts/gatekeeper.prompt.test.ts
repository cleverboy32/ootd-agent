/**
 * Gatekeeper Prompt Regression Tests
 *
 * 调真实 LLM，验证关键意图字段是否符合预期。
 * 运行命令：pnpm test:prompts
 *
 * 设计原则：
 * - 断言核心字段（request_type / wardrobe_search_query），不断言 gatekeeper_reply 措辞
 * - LLM 有小概率波动，关键字段必须匹配
 * - 每个 fixture 代表一类真实发生过的问题场景
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Content } from '@google/genai';
import { callGatekeeperAgent } from '@/server/agents/gatekeeper/agent';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function userMsg(text: string): Content {
  return { role: 'user', parts: [{ text }] };
}

function aiMsg(text: string): Content {
  return { role: 'model', parts: [{ text }] };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

describe('Gatekeeper — wardrobe browse intent', () => {
  it('「有没有白裙子」→ wardrobe_pairing + wardrobe_search_query 含白色裙', async () => {
    const result = await callGatekeeperAgent(
      [],
      [{ text: '我衣橱里有没有白裙子' }],
      {}
    );

    assert.equal(result.extracted_intent.request_type, 'wardrobe_pairing');
    assert.match(
      result.extracted_intent.wardrobe_search_query ?? '',
      /白|white/i,
      'wardrobe_search_query 应含白色相关词'
    );
    assert.match(
      result.extracted_intent.wardrobe_search_query ?? '',
      /裙|dress|skirt/i,
      'wardrobe_search_query 应含裙子相关词'
    );
  });

  it('「想看看」（上轮已提白裙）→ wardrobe_pairing，不进 clarify', async () => {
    const history: Content[] = [
      userMsg('我衣橱里有没有白裙子'),
      aiMsg('在帮你查找衣橱里的白裙子，请选择你想要的款式～'),
    ];

    const result = await callGatekeeperAgent(
      history,
      [{ text: '想看看' }],
      {}
    );

    assert.equal(result.extracted_intent.request_type, 'wardrobe_pairing');
  });

  it('用户纠错「这不是绿色的吗」→ wardrobe_pairing，不进 clarify', async () => {
    const history: Content[] = [
      userMsg('我想看看白裙子'),
      aiMsg('好的，为你找到了一件浅绿色连衣裙～'),
    ];

    const result = await callGatekeeperAgent(
      history,
      [{ text: '这不是绿色的裙子吗' }],
      {}
    );

    assert.notEqual(
      result.extracted_intent.request_type,
      'clarify',
      '纠错时不应进入 clarify 死循环'
    );
    assert.equal(result.extracted_intent.request_type, 'wardrobe_pairing');
  });
});

describe('Gatekeeper — style advice intent', () => {
  it('「高级感色彩搭配公式」→ style_advice，直接放行', async () => {
    const result = await callGatekeeperAgent(
      [],
      [{ text: '高级感色彩搭配公式是什么' }],
      {}
    );

    assert.equal(result.extracted_intent.request_type, 'style_advice');
    assert.equal(result.is_complete, true, 'style_advice 有主题应直接放行');
  });

  it('style_advice 放行后用户说「给我搭一套」→ wardrobe_outfit', async () => {
    const history: Content[] = [
      userMsg('高级感色彩搭配公式是什么'),
      aiMsg('高级感配色有三大公式：同色系叠穿、中性色+点缀色...'),
    ];

    const result = await callGatekeeperAgent(
      history,
      [{ text: '给我搭一套吧' }],
      {}
    );

    assert.ok(
      ['wardrobe_outfit', 'wardrobe_pairing'].includes(result.extracted_intent.request_type),
      `应进入搭配流程，实际: ${result.extracted_intent.request_type}`
    );
  });
});

describe('Gatekeeper — outfit selection / confirmed', () => {
  it('「就第一套吧」→ outfit_selection，不放行', async () => {
    const history: Content[] = [
      userMsg('帮我搭一套通勤穿搭'),
      aiMsg('[方案一] ...[方案二] ...'),
    ];

    const result = await callGatekeeperAgent(
      history,
      [{ text: '就第一套吧' }],
      {}
    );

    assert.equal(result.extracted_intent.request_type, 'outfit_selection');
    assert.equal(result.is_complete, false);
    assert.ok(result.gatekeeper_reply, '应有追问回复');
  });

  it('「满意不用调整了」→ outfit_confirmed，不再追问', async () => {
    const history: Content[] = [
      userMsg('帮我搭一套通勤穿搭'),
      aiMsg('[方案一] ...[方案二] ...'),
      userMsg('就第一套吧'),
      aiMsg('好的，请问还需要微调吗？'),
    ];

    const result = await callGatekeeperAgent(
      history,
      [{ text: '满意，不用调整了' }],
      {}
    );

    assert.equal(result.extracted_intent.request_type, 'outfit_confirmed');
    assert.doesNotMatch(result.gatekeeper_reply ?? '', /微调|调整/, '不应再追问微调');
  });
});

describe('Gatekeeper — wardrobe outfit intent', () => {
  it('有明确场合 → wardrobe_outfit 放行', async () => {
    const result = await callGatekeeperAgent(
      [],
      [{ text: '帮我搭一套明天上班的穿搭' }],
      {}
    );

    assert.equal(result.extracted_intent.request_type, 'wardrobe_outfit');
    assert.equal(result.is_complete, true);
    assert.ok(result.extracted_intent.occasion, '应提取场合');
  });

  it('无场合 → wardrobe_outfit 不放行，追问场合', async () => {
    const result = await callGatekeeperAgent(
      [],
      [{ text: '帮我搭一套' }],
      {}
    );

    assert.equal(result.extracted_intent.request_type, 'wardrobe_outfit');
    assert.equal(result.is_complete, false);
  });
});
