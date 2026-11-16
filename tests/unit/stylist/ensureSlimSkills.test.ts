import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ensureNoStyleBasicsSkills,
  ensureOutfitCompatibilitySkill,
  ensureStylistVisualSkill,
  filterSkillsForWardrobeSearch,
} from '@/server/agents/stylist/skillSelection';
import { STYLIST_SYSTEM_INSTRUCTION } from '@/server/agents/stylist/prompts';
import { loadSkill } from '@/server/skills/loadSkill';
import {
  parseWardrobeSearchSlot,
  resolveMainCategoryForSlot,
} from '@/server/utils/ragSearchSlots';
import { resolveSlotTempFilter } from '@/server/utils/slotTempFilter';
import { ClothingMainCategory } from '@prisma/client';

describe('ensureStylistVisualSkill', () => {
  it('prepends stylist-visual', () => {
    assert.deepEqual(ensureStylistVisualSkill(['style-sweet']), [
      'stylist-visual',
      'style-sweet',
    ]);
  });

  it('does not duplicate', () => {
    assert.deepEqual(ensureStylistVisualSkill(['stylist-visual', 'weather-dressing']), [
      'stylist-visual',
      'weather-dressing',
    ]);
  });
});

describe('ensureOutfitCompatibilitySkill', () => {
  it('prepends outfit-compatibility with or without style', () => {
    assert.deepEqual(ensureOutfitCompatibilitySkill(['style-cool']), [
      'outfit-compatibility',
      'style-cool',
    ]);
    assert.deepEqual(ensureOutfitCompatibilitySkill(['weather-dressing']), [
      'outfit-compatibility',
      'weather-dressing',
    ]);
  });

  it('does not duplicate', () => {
    assert.deepEqual(
      ensureOutfitCompatibilitySkill(['outfit-compatibility', 'style-sweet']),
      ['outfit-compatibility', 'style-sweet']
    );
  });
});

describe('ensureNoStyleBasicsSkills', () => {
  it('injects outfit-basics + accessory-pairing when no style', () => {
    assert.deepEqual(ensureNoStyleBasicsSkills(['weather-dressing']), [
      'outfit-basics',
      'accessory-pairing',
      'weather-dressing',
    ]);
  });

  it('does not inject when style present; strips stray basics', () => {
    assert.deepEqual(
      ensureNoStyleBasicsSkills(['outfit-basics', 'accessory-pairing', 'style-sweet']),
      ['style-sweet']
    );
  });

  it('does not duplicate when already present', () => {
    assert.deepEqual(
      ensureNoStyleBasicsSkills(['outfit-basics', 'accessory-pairing', 'weather-dressing']),
      ['outfit-basics', 'accessory-pairing', 'weather-dressing']
    );
  });
});

describe('filterSkillsForWardrobeSearch with basics', () => {
  it('keeps outfit-basics, accessory-pairing, outfit-compatibility; drops stylist-visual', () => {
    assert.deepEqual(
      filterSkillsForWardrobeSearch([
        'stylist-visual',
        'outfit-compatibility',
        'outfit-basics',
        'accessory-pairing',
        'style-korean',
        'body-petite',
      ]),
      ['outfit-compatibility', 'outfit-basics', 'accessory-pairing', 'style-korean']
    );
  });
});

describe('legwear slot', () => {
  it('maps legwear to SOCKS mainCategory', () => {
    assert.equal(parseWardrobeSearchSlot('legwear'), 'legwear');
    assert.equal(resolveMainCategoryForSlot('legwear'), ClothingMainCategory.SOCKS);
  });

  it('cold band uses thick_tights on legwear not accessory', () => {
    assert.ok(resolveSlotTempFilter('cold', 'legwear'));
    assert.equal(resolveSlotTempFilter('cold', 'accessory'), null);
  });
});

describe('slim base + new skills content', () => {
  it('base has layer/legwear map and skill pointers; no styling lesson or visual guide', () => {
    assert.match(STYLIST_SYSTEM_INSTRUCTION, /冲突优先级/);
    assert.match(STYLIST_SYSTEM_INSTRUCTION, /outfit-basics/);
    assert.match(STYLIST_SYSTEM_INSTRUCTION, /outfit-compatibility/);
    assert.match(STYLIST_SYSTEM_INSTRUCTION, /legwear/);
    assert.match(STYLIST_SYSTEM_INSTRUCTION, /三明治映射/);
    assert.match(STYLIST_SYSTEM_INSTRUCTION, /禁止用「有外套 \/ 无外套」/);
    assert.doesNotMatch(STYLIST_SYSTEM_INSTRUCTION, /【视觉构想指南/);
    assert.doesNotMatch(STYLIST_SYSTEM_INSTRUCTION, /model_pose 只写姿态和神态/);
    assert.doesNotMatch(STYLIST_SYSTEM_INSTRUCTION, /色彩协调学|版型互补学|科学搭配/);
  });

  it('loads stylist-visual / outfit-basics / accessory-pairing / outfit-compatibility', () => {
    assert.match(loadSkill('stylist-visual'), /视觉构想|outfit_details|legwear/);
    assert.match(loadSkill('outfit-basics'), /主角|一种对比|明度结构/);
    assert.match(loadSkill('outfit-basics'), /outfit-compatibility/);
    assert.doesNotMatch(loadSkill('outfit-basics'), /白色衬衫配直筒裤/);
    assert.doesNotMatch(loadSkill('outfit-basics'), /场合正式度/);
    assert.match(loadSkill('accessory-pairing'), /开槽|金属|legwear/);
    assert.match(loadSkill('accessory-pairing'), /outfit-compatibility/);
    assert.doesNotMatch(loadSkill('accessory-pairing'), /金细链耳环/);
    assert.match(loadSkill('outfit-compatibility'), /气质同族|氛围对齐|面料族相容/);
    assert.doesNotMatch(loadSkill('outfit-compatibility'), /正式度同档/);
    assert.doesNotMatch(loadSkill('outfit-compatibility'), /白色衬衫配直筒裤/);
  });
});
