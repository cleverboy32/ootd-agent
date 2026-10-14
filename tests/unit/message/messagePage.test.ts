import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMessagePage,
  parseMessagePageLimit,
  MESSAGE_PAGE_DEFAULT_LIMIT,
  MESSAGE_PAGE_MAX_LIMIT,
} from '@/server/utils/messagePage';

type Row = { id: string; role: string };

/** 按时间正序构造 m1..mN，再按接口查询顺序（最新在前）返回 */
function rowsDesc(roles: string[]): Row[] {
  return roles.map((role, i) => ({ id: `m${i + 1}`, role })).reverse();
}

const ids = (rows: Row[]): string[] => rows.map((r) => r.id);

describe('buildMessagePage', () => {
  it('行数不超过 limit 时没有更多页，结果为正序', () => {
    const page = buildMessagePage(rowsDesc(['user', 'ai', 'user', 'ai']), 4);
    assert.deepEqual(ids(page.messages), ['m1', 'm2', 'm3', 'm4']);
    assert.equal(page.nextCursor, null);
  });

  it('行数为 limit + 1 时返回 limit 条，nextCursor 指向本页最旧一条', () => {
    const page = buildMessagePage(rowsDesc(['ai', 'user', 'ai', 'user', 'ai']), 4);
    assert.deepEqual(ids(page.messages), ['m2', 'm3', 'm4', 'm5']);
    assert.equal(page.nextCursor, 'm2');
  });

  it('有更多页且页首不是 user 时，丢弃页首直至首条为 user', () => {
    const page = buildMessagePage(rowsDesc(['user', 'ai', 'ai', 'user', 'ai']), 4);
    assert.deepEqual(ids(page.messages), ['m4', 'm5']);
    assert.equal(page.nextCursor, 'm4');
  });

  it('没有更多页时页首为 ai 也不丢弃', () => {
    const page = buildMessagePage(rowsDesc(['ai', 'user', 'ai']), 4);
    assert.deepEqual(ids(page.messages), ['m1', 'm2', 'm3']);
    assert.equal(page.nextCursor, null);
  });

  it('整页没有 user 消息时原样返回，避免空页导致翻页停滞', () => {
    const page = buildMessagePage(rowsDesc(['user', 'ai', 'ai', 'ai']), 3);
    assert.deepEqual(ids(page.messages), ['m2', 'm3', 'm4']);
    assert.equal(page.nextCursor, 'm2');
  });

  it('空结果', () => {
    const page = buildMessagePage([], 20);
    assert.deepEqual(page.messages, []);
    assert.equal(page.nextCursor, null);
  });
});

describe('parseMessagePageLimit', () => {
  it('缺省或非法值回落到默认值', () => {
    assert.equal(parseMessagePageLimit(null), MESSAGE_PAGE_DEFAULT_LIMIT);
    assert.equal(parseMessagePageLimit(''), MESSAGE_PAGE_DEFAULT_LIMIT);
    assert.equal(parseMessagePageLimit('abc'), MESSAGE_PAGE_DEFAULT_LIMIT);
  });

  it('夹紧到 [1, MAX]', () => {
    assert.equal(parseMessagePageLimit('0'), 1);
    assert.equal(parseMessagePageLimit('-5'), 1);
    assert.equal(parseMessagePageLimit('1000'), MESSAGE_PAGE_MAX_LIMIT);
    assert.equal(parseMessagePageLimit('30'), 30);
  });

  it('小数向下取整', () => {
    assert.equal(parseMessagePageLimit('12.9'), 12);
  });
});
