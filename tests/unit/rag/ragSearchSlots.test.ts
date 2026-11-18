import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ClothingMainCategory } from '@prisma/client';
import {
  parseWardrobeSearchSlot,
  resolveMainCategoryForSlot,
} from '@/server/utils/ragSearchSlots';

describe('resolveMainCategoryForSlot', () => {
  it('maps core sandwich slots to ClothingMainCategory', () => {
    assert.equal(resolveMainCategoryForSlot('top'), ClothingMainCategory.TOP);
    assert.equal(resolveMainCategoryForSlot('bottom'), ClothingMainCategory.BOTTOM);
    assert.equal(resolveMainCategoryForSlot('outerwear'), ClothingMainCategory.OUTERWEAR);
    assert.equal(resolveMainCategoryForSlot('shoes'), ClothingMainCategory.FOOTWEAR);
    assert.equal(resolveMainCategoryForSlot('skirt'), ClothingMainCategory.ONE_PIECE);
    assert.equal(parseWardrobeSearchSlot('dress'), 'skirt');
    assert.equal(resolveMainCategoryForSlot('dress'), ClothingMainCategory.ONE_PIECE);
    assert.equal(resolveMainCategoryForSlot('accessory'), ClothingMainCategory.ACCESSORY);
  });

  it('maps legwear to SOCKS (not ACCESSORY)', () => {
    assert.equal(parseWardrobeSearchSlot('legwear'), 'legwear');
    assert.equal(resolveMainCategoryForSlot('legwear'), ClothingMainCategory.SOCKS);
    assert.notEqual(resolveMainCategoryForSlot('legwear'), ClothingMainCategory.ACCESSORY);
  });

  it('maps inner_top as first-class slot to TOP (not collapsed to top)', () => {
    assert.equal(parseWardrobeSearchSlot('inner_top'), 'inner_top');
    assert.equal(resolveMainCategoryForSlot('inner_top'), ClothingMainCategory.TOP);
    assert.notEqual(parseWardrobeSearchSlot('inner_top'), 'top');
  });

  it('maps inner_bottom as first-class slot to BOTTOM (not collapsed to bottom)', () => {
    assert.equal(parseWardrobeSearchSlot('inner_bottom'), 'inner_bottom');
    assert.equal(resolveMainCategoryForSlot('inner_bottom'), ClothingMainCategory.BOTTOM);
    assert.notEqual(parseWardrobeSearchSlot('inner_bottom'), 'bottom');
  });

  it('returns undefined for unknown / empty slot (caller must not unscoped-search)', () => {
    assert.equal(resolveMainCategoryForSlot(undefined), undefined);
    assert.equal(resolveMainCategoryForSlot(''), undefined);
    assert.equal(resolveMainCategoryForSlot('not_a_slot'), undefined);
  });
});
