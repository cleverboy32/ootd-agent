import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceLegwearMainCategory,
  coerceSkirtMainCategory,
  normalizeMainCategory,
  normalizeSeasonList,
  normalizeWardrobeAnalysis,
  WARDROBE_ANALYSIS_PROMPT,
} from '@/server/utils/wardrobeAnalysis';

describe('WARDROBE_ANALYSIS_PROMPT', () => {
  it('writes Chinese exterior text and keeps lining out of the main color', () => {
    assert.match(WARDROBE_ANALYSIS_PROMPT, /自由文本全部用中文/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /不要写成光滑衬衫/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /不要记成第二种颜色/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /不要写成镶边/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /款式名不决定温度/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /棉服看蓬松/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /不要写成轻薄、轻量或薄壳/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /短袖 T\/Polo.*24-35/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /薄款长袖打底.*16-23/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /加绒卫衣\/重磅厚毛衣：5-14/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /摇粒绒\/抓绒套头衫.*mainCategory=TOP/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /仅半开襟套头 → TOP/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /OUTERWEAR 与 TOP 分界/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /常规牛仔裤\/休闲西裤.*12-23/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /常规厚度中长连衣裙\/半身裙.*12-23/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /无袖睡裙\/家居睡裙.*24-38/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /禁止自创 12-25/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /全皮板鞋\/德训\/复古跑鞋.*8-30/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /超薄隐形丝袜 5-10D：24-35/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /加绒\/羊羔绒打底裤.*mainCategory=SOCKS/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /SOCKS 与 BOTTOM 分界/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /禁止把打底裤\/光腿神器标成 BOTTOM/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /ONE_PIECE 与 BOTTOM 分界/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /禁止把半身裙标成 BOTTOM/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /禁止把任何裙装标成 BOTTOM/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /禁止自创更宽档/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /硬折、有型、格纹不等于厚/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /偏薄下装 season 应含夏/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /下装不因外套叠穿压低 tempMin/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /宁少勿滥/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /运动训练/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /禁止顺手加「休闲」「百搭」「日常」/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /也可日常休闲/);
  });

  it('maps Chinese season and formality onto the stored enums', () => {
    assert.deepEqual(normalizeSeasonList(['春', '秋季']), ['spring', 'autumn']);
    const normalized = normalizeWardrobeAnalysis({
      mainCategory: 'OUTERWEAR',
      subCategory: '棒球夹克',
      season: ['秋', '冬'],
      material: ['尼龙'],
      colors: ['炭灰'],
      tags: ['休闲'],
      description: '炭灰尼龙棒球夹克。',
      formality: '商务休闲',
    });
    assert.deepEqual(normalized?.season, ['autumn', 'winter']);
    assert.equal(normalized?.formality, 'smart-casual');

    const athletic = normalizeWardrobeAnalysis({
      mainCategory: 'BOTTOM',
      subCategory: '运动紧身短裤',
      season: ['夏'],
      material: ['氨纶'],
      colors: ['灰'],
      tags: ['运动', '瑜伽'],
      description: '运动弹力紧身短裤。',
      formality: '运动训练',
    });
    assert.equal(athletic?.formality, 'athletic');

    const lounge = normalizeWardrobeAnalysis({
      mainCategory: 'BOTTOM',
      subCategory: '睡裤',
      season: ['春', '夏', '秋', '冬'],
      material: ['棉'],
      colors: ['灰'],
      tags: ['居家'],
      description: '棉质睡裤。',
      formality: '居家',
    });
    assert.equal(lounge?.formality, 'lounge');
  });
});

describe('normalizeMainCategory', () => {
  it('accepts canonical enum values', () => {
    assert.equal(normalizeMainCategory('OUTERWEAR'), 'OUTERWEAR');
  });

  it('normalizes casing and aliases', () => {
    assert.equal(normalizeMainCategory('outerwear'), 'OUTERWEAR');
    assert.equal(normalizeMainCategory('Shoes'), 'FOOTWEAR');
    assert.equal(normalizeMainCategory('dress'), 'ONE_PIECE');
    assert.equal(normalizeMainCategory('socks'), 'SOCKS');
    assert.equal(normalizeMainCategory('legwear'), 'SOCKS');
    assert.equal(normalizeMainCategory('袜子'), 'SOCKS');
  });
});

describe('coerceLegwearMainCategory', () => {
  it('moves 打底裤 from BOTTOM to SOCKS', () => {
    assert.equal(coerceLegwearMainCategory('BOTTOM', '羊羔绒打底裤'), 'SOCKS');
    assert.equal(coerceLegwearMainCategory('BOTTOM', '加绒长款打底裤'), 'SOCKS');
    assert.equal(coerceLegwearMainCategory('BOTTOM', '光腿神器'), 'SOCKS');
  });

  it('keeps wearable yoga/sport tights as BOTTOM', () => {
    assert.equal(coerceLegwearMainCategory('BOTTOM', '瑜伽裤'), 'BOTTOM');
    assert.equal(coerceLegwearMainCategory('BOTTOM', '运动紧身长裤'), 'BOTTOM');
  });
});

describe('coerceSkirtMainCategory', () => {
  it('moves 半身裙 from BOTTOM to ONE_PIECE', () => {
    assert.equal(coerceSkirtMainCategory('BOTTOM', '毛呢半身裙'), 'ONE_PIECE');
    assert.equal(coerceSkirtMainCategory('BOTTOM', 'A字短裙'), 'ONE_PIECE');
  });

  it('keeps pants as BOTTOM', () => {
    assert.equal(coerceSkirtMainCategory('BOTTOM', '直筒牛仔裤'), 'BOTTOM');
  });
});

describe('normalizeWardrobeAnalysis', () => {
  it('coerces string arrays and lowercase mainCategory', () => {
    const normalized = normalizeWardrobeAnalysis({
      mainCategory: 'top',
      subCategory: 'T-shirt',
      season: 'Spring, Summer',
      material: 'cotton',
      colors: 'white',
      tags: ['casual'],
      description: 'A white tee.',
      searchDescription: 'Casual tee for commute and weekend.',
      occasions: 'office, commute',
      formality: 'casual',
      silhouette: ['regular'],
    });

    assert.ok(normalized);
    assert.equal(normalized?.mainCategory, 'TOP');
    assert.deepEqual(normalized?.season, ['spring', 'summer']);
    assert.deepEqual(normalized?.material, ['cotton']);
    assert.deepEqual(normalized?.colors, ['white']);
    assert.deepEqual(normalized?.occasions, ['office', 'commute']);
    assert.equal(normalized?.searchDescription, 'Casual tee for commute and weekend.');
    assert.equal(normalized?.tempMin, null);
    assert.equal(normalized?.tempMax, null);
  });

  it('keeps an appropriate temperature range and swaps inverted bounds', () => {
    const normalized = normalizeWardrobeAnalysis({
      mainCategory: 'OUTERWEAR',
      subCategory: 'Puffer Jacket',
      season: ['Winter'],
      material: ['down'],
      colors: ['gray'],
      tags: ['warm'],
      description: 'A gray hooded puffer.',
      tempMin: 20,
      tempMax: 5,
    });
    assert.equal(normalized?.tempMin, 5);
    assert.equal(normalized?.tempMax, 20);
  });

  it('returns null when required fields are missing', () => {
    assert.equal(normalizeWardrobeAnalysis({ mainCategory: 'TOP' }), null);
  });

  it('coerces mislabeled 打底裤 BOTTOM into SOCKS', () => {
    const normalized = normalizeWardrobeAnalysis({
      mainCategory: 'BOTTOM',
      subCategory: '羊羔绒打底裤',
      season: ['秋', '冬'],
      material: ['羊羔绒'],
      colors: ['灰'],
      tags: ['保暖'],
      description: '灰色罗纹针织外层的高腰打底裤，内里羊羔绒。',
      tempMin: -8,
      tempMax: 6,
    });
    assert.equal(normalized?.mainCategory, 'SOCKS');
  });

  it('coerces mislabeled 半身裙 BOTTOM into ONE_PIECE', () => {
    const normalized = normalizeWardrobeAnalysis({
      mainCategory: 'BOTTOM',
      subCategory: '毛呢半身裙',
      season: ['秋', '冬'],
      material: ['毛呢'],
      colors: ['咖'],
      tags: ['通勤'],
      description: '咖啡色毛呢半身长裙，A字版型。',
      tempMin: 4,
      tempMax: 15,
    });
    assert.equal(normalized?.mainCategory, 'ONE_PIECE');
  });
});
