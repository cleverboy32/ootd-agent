import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isSmallJewelryScaleTarget,
  prepareAccessoryOnBodyScaleRef,
  scaleAccessoryReferenceImages,
} from '@/server/utils/accessoryScaleRef';

describe('isSmallJewelryScaleTarget', () => {
  it('耳环项链要缩放，包帽不缩放', () => {
    assert.equal(isSmallJewelryScaleTarget('圆环耳环 真人佩戴比例 | accessory'), true);
    assert.equal(isSmallJewelryScaleTarget('Pendant Necklace | ACCESSORY'), true);
    assert.equal(isSmallJewelryScaleTarget('托特包 | accessory | bag'), false);
    assert.equal(isSmallJewelryScaleTarget('白衬衫 | top'), false);
  });
});

describe('prepareAccessoryOnBodyScaleRef', () => {
  it('输出固定大画布，主体明显小于画布', async () => {
    const sharp = (await import('sharp')).default;
    // 模拟满屏产品特写
    const closeup = await sharp({
      create: {
        width: 800,
        height: 800,
        channels: 3,
        background: { r: 200, g: 160, b: 40 },
      },
    })
      .jpeg()
      .toBuffer();

    const scaled = await prepareAccessoryOnBodyScaleRef(closeup);
    const meta = await sharp(scaled).metadata();
    assert.equal(meta.width, 1024);
    assert.equal(meta.height, 1024);

    // 中心有金色主体；四角浅灰底板；高度约 4% 画布
    const { data, info } = await sharp(scaled)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const idx = (x: number, y: number) => (y * info.width + x) * info.channels;
    const corner = data[idx(8, 8)]!;
    const center = data[idx(512, 512)]!;
    assert.ok(corner > 230, `corner should be light pad, got ${corner}`);
    assert.ok(center < 220, `center should keep jewelry tone, got ${center}`);

    let minY = info.height;
    let maxY = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = idx(x, y);
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        if (r > 150 && g > 100 && b < 80) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const jewelryH = maxY - minY + 1;
    assert.ok(jewelryH > 0, 'expected jewelry blob');
    assert.ok(
      jewelryH <= Math.round(1024 * 0.02),
      `jewelry height ${jewelryH} should be ≤2% of canvas`
    );
  });
});

describe('scaleAccessoryReferenceImages', () => {
  it('只替换小首饰 URL 为 data jpeg', async () => {
    const sharp = (await import('sharp')).default;
    const jpeg = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 3,
        background: { r: 180, g: 180, b: 20 },
      },
    })
      .jpeg()
      .toBuffer();
    const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    const topUrl = 'https://example.com/top.jpg';

    const out = await scaleAccessoryReferenceImages(
      [topUrl, dataUrl],
      ['白衬衫 | top', '圆环耳环 | accessory']
    );
    assert.equal(out[0], topUrl);
    assert.match(out[1], /^data:image\/jpeg;base64,/);
    assert.notEqual(out[1], dataUrl);
  });
});
