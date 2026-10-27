import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { garmentReferencesForAudit, isImageUnreadableCritique } from '@/server/agents/visual/critic';

describe('isImageUnreadableCritique', () => {
  it('detects unsupported / unreadable image critiques', () => {
    assert.equal(
      isImageUnreadableCritique(
        '上传的图片无法显示或格式不受支持，无法核验单品完整度'
      ),
      true
    );
    assert.equal(
      isImageUnreadableCritique('无法查看上传的图片（系统显示 Unsupported Image）'),
      true
    );
    assert.equal(isImageUnreadableCritique('未能成功读取上传的图片，无法进行对比审核。'), true);
  });

  it('does not flag real styling failures', () => {
    assert.equal(
      isImageUnreadableCritique('短裤颜色画成了白色，而不是暗灰色'),
      false
    );
    assert.equal(isImageUnreadableCritique('下装缺失，模特光腿'), false);
  });
});

describe('garmentReferencesForAudit', () => {
  it('keeps public garment photos and drops data urls', () => {
    const refs = garmentReferencesForAudit([
      { url: 'https://cdn.example/shirt.jpg', label: '衬衫 (inner_top) — purchase ref' },
      { url: 'data:image/jpeg;base64,abc', label: '裤子' },
      { url: 'https://cdn.example/shirt.jpg', label: '重复' },
      { url: 'https://cdn.example/pants.jpg', label: '  阔腿裤 (bottom) — purchase ref  ' },
    ]);
    assert.deepEqual(
      refs.map((ref) => ref.url),
      ['https://cdn.example/shirt.jpg', 'https://cdn.example/pants.jpg']
    );
    assert.equal(refs[1].label, '阔腿裤 (bottom) — purchase ref');
  });
});
