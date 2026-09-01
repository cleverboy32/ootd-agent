import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGatekeeperOutput } from '@/server/utils/gatekeeperEvaluator';
import { normalizeGatekeeperIntent } from '@/server/agents/intent';
import { finalizeGatekeeperResult } from '@/server/agents/intent';

describe('evaluateGatekeeperOutput', () => {
  it('passes a complete wardrobe_outfit with occasion', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'wardrobe_outfit',
        occasion: '上班通勤',
        dressing_climate: 'mild',
      }),
    });

    const evalResult = evaluateGatekeeperOutput(result, {
      contextText: '帮我搭一套上班通勤的穿搭',
    });

    assert.equal(evalResult.passed, true);
    assert.equal(evalResult.score, 100);
    assert.equal(evalResult.issues.length, 0);
  });

  it('fails wardrobe_outfit marked complete without occasion', () => {
    const result = {
      is_complete: true,
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'wardrobe_outfit',
        occasion: '',
      }),
      followup_questions: [],
    };

    const evalResult = evaluateGatekeeperOutput(result);
    assert.equal(evalResult.passed, false);
    assert.ok(evalResult.issues.some((i) => i.code === 'WARDROBE_MISSING_OCCASION'));
  });

  it('fails clarify without gatekeeper_reply', () => {
    const result = {
      is_complete: false,
      extracted_intent: normalizeGatekeeperIntent({ request_type: 'clarify' }),
      followup_questions: [],
    };

    const evalResult = evaluateGatekeeperOutput(result);
    assert.equal(evalResult.passed, false);
    assert.ok(evalResult.issues.some((i) => i.code === 'SHORT_CIRCUIT_MISSING_REPLY'));
  });

  it('passes outfit_selection short-circuit with reply', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'outfit_selection',
        selected_outfit_id: 'outfit_1',
      }),
    });

    const evalResult = evaluateGatekeeperOutput(result);
    assert.equal(evalResult.passed, true);
    assert.equal(result.is_complete, false);
    assert.ok(result.gatekeeper_reply);
  });

  it('passes outfit_confirmed short-circuit with reply', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'outfit_confirmed',
        selected_outfit_id: 'outfit_1',
      }),
    });

    const evalResult = evaluateGatekeeperOutput(result);
    assert.equal(evalResult.passed, true);
    assert.doesNotMatch(result.gatekeeper_reply ?? '', /微调/);
  });

  it('fails wardrobe_pairing complete without anchor_wardrobe_id', () => {
    const result = {
      is_complete: true,
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'wardrobe_pairing',
        anchor_item_summary: '绿色裙子',
        anchor_slot: 'dress',
        occasion: '逛街',
      }),
      followup_questions: [],
    };

    const evalResult = evaluateGatekeeperOutput(result);
    assert.equal(evalResult.passed, false);
    assert.ok(evalResult.issues.some((i) => i.code === 'WARDROBE_PAIRING_INCOMPLETE_ANCHOR'));
  });

  it('fails purchase_pairing complete without anchor fields', () => {
    const result = {
      is_complete: true,
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'purchase_pairing',
        occasion: '日常百搭',
        anchor_item_summary: '',
        anchor_slot: '',
      }),
      followup_questions: [],
    };

    const evalResult = evaluateGatekeeperOutput(result);
    assert.equal(evalResult.passed, false);
    assert.ok(evalResult.issues.some((i) => i.code === 'PURCHASE_PAIRING_INCOMPLETE_ANCHOR'));
  });

  it('warns when accessory is mislabeled as top', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'purchase_pairing',
        occasion: '日常百搭',
        anchor_item_summary: '金色圆环耳环，铆钉细节',
        anchor_slot: 'top',
      }),
    });

    const evalResult = evaluateGatekeeperOutput(result);
    assert.ok(evalResult.issues.some((i) => i.code === 'ACCESSORY_SLOT_MISLABEL'));
  });

  it('warns when outerwear is mislabeled as dress', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'wardrobe_pairing',
        occasion: '日常',
        anchor_item_summary: '冬季灰色长毛呢外套',
        anchor_slot: 'dress',
      }),
    });

    const evalResult = evaluateGatekeeperOutput(result);
    assert.ok(evalResult.issues.some((i) => i.code === 'OUTERWEAR_SLOT_MISLABEL'));
  });

  it('warns on style hallucination not present in context', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'wardrobe_outfit',
        occasion: '约会',
        style_preference: '美式复古',
      }),
    });

    const evalResult = evaluateGatekeeperOutput(result, {
      contextText: '帮我搭一套约会穿搭',
    });

    assert.ok(evalResult.issues.some((i) => i.code === 'STYLE_NOT_IN_CONTEXT'));
  });

  it('does not warn when outfit flow has empty dressing_climate (server derives later)', () => {
    const result = {
      is_complete: true,
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'wardrobe_outfit',
        occasion: '上班通勤',
        dressing_climate: '',
      }),
      followup_questions: [],
    };

    const evalResult = evaluateGatekeeperOutput(result);
    assert.equal(
      evalResult.issues.some((i) => i.code === 'MISSING_DRESSING_CLIMATE'),
      false
    );
  });

  it('warns when purchase_pairing requests weather lookup', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'purchase_pairing',
        occasion: '日常百搭',
        anchor_item_summary: '蓝白条纹衬衫',
        anchor_slot: 'top',
      }),
    });

    const evalResult = evaluateGatekeeperOutput(result, {
      weatherLookup: { needed: true, city: '' },
    });

    assert.ok(evalResult.issues.some((i) => i.code === 'PURCHASE_PAIRING_WEATHER_LOOKUP'));
  });

  it('warns when feedback_revision completes with unstated outfit id among multiple outfits', () => {
    const result = {
      is_complete: true,
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'feedback_revision',
        special_requests: '去掉外套',
        selected_outfit_id: 'outfit_1',
      }),
      followup_questions: [],
    };

    const evalResult = evaluateGatekeeperOutput(result, {
      contextText: '用户: 这套裙子怎么搭\n助手: ### 方案一\n### 方案二\n用户: 去掉外套',
      currentMessageText: '去掉外套',
    });

    assert.ok(evalResult.issues.some((i) => i.code === 'REVISION_OUTFIT_ID_NOT_STATED'));
  });
});
