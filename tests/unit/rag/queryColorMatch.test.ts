import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractQueryColorFamilies,
  filterItemsByQueryColor,
  itemMatchesQueryColorFamilies,
  normalizeWardrobeSearchQuery,
} from '@/server/utils/queryColorMatch';

describe('queryColorMatch', () => {
  it('extracts white family from 白裙子', () => {
    assert.deepEqual(extractQueryColorFamilies('白色裙子'), ['white']);
  });

  it('rejects light green item for white query', () => {
    assert.equal(itemMatchesQueryColorFamilies(['white'], ['light green']), false);
  });

  it('accepts cream item for white query', () => {
    assert.equal(itemMatchesQueryColorFamilies(['white'], ['cream']), true);
  });

  it('filters mismatched items from search results', () => {
    const items = [
      { id: '1', colors: ['light green'], similarity: 0.65 },
      { id: '2', colors: ['white'], similarity: 0.6 },
    ];
    const { matched, rejected } = filterItemsByQueryColor('白色裙子', items);
    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, '2');
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].id, '1');
  });
});

describe('normalizeWardrobeSearchQuery', () => {
  it('strips browse noise and keeps color + category', () => {
    assert.equal(
      normalizeWardrobeSearchQuery('用户想查看衣橱里的白裙子并进行搭配示范'),
      '白裙子'
    );
  });

  it('normalizes query衣橱查询 prefix', () => {
    assert.equal(normalizeWardrobeSearchQuery('查询衣橱内是否有白裙子'), '白裙子');
  });

  it('composes color and category when scattered', () => {
    assert.equal(normalizeWardrobeSearchQuery('想看看白色衬衫'), '白色衬衫');
  });

  it('leaves compact query unchanged', () => {
    assert.equal(normalizeWardrobeSearchQuery('白色裙子'), '白色裙子');
  });
});
