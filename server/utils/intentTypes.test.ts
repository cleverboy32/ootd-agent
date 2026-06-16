import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  correctAnchorSlot,
  inferAnchorSlotFromSummary,
  normalizeGatekeeperIntent,
} from '@/app/api/generate-with-image/handlers/intentTypes';

describe('inferAnchorSlotFromSummary', () => {
  it('classifies earrings and necklaces as accessory', () => {
    assert.equal(inferAnchorSlotFromSummary('金色圆环耳环，带有铆钉装饰细节'), 'accessory');
    assert.equal(inferAnchorSlotFromSummary('金色珠串项链，黑色方形吊坠'), 'accessory');
  });

  it('classifies garments correctly', () => {
    assert.equal(inferAnchorSlotFromSummary('蓝白细条纹棉质衬衫'), 'top');
    assert.equal(inferAnchorSlotFromSummary('高腰阔腿牛仔裤'), 'bottom');
    assert.equal(inferAnchorSlotFromSummary('白色复古德训鞋'), 'shoes');
  });
});

describe('correctAnchorSlot', () => {
  it('fixes mislabeled earring anchor from top to accessory', () => {
    const intent = normalizeGatekeeperIntent({
      request_type: 'purchase_pairing',
      anchor_item_summary: '金色圆环耳环，带有铆钉装饰细节',
      anchor_slot: 'top',
      occasion: '日常百搭',
    });

    const fixed = correctAnchorSlot(intent, '这副耳环');
    assert.equal(fixed.anchor_slot, 'accessory');
  });
});
