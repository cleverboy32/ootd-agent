import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceLegwearMainCategory,
  coerceSkirtMainCategory,
  looksLikeThermalInnerBottomPants,
  normalizeMainCategory,
  normalizeSeasonList,
  normalizeWardrobeAnalysis,
  sanitizeThermalInnerBottomFields,
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
    assert.match(WARDROBE_ANALYSIS_PROMPT, /羊羔绒\/加厚加绒\*\*袜型\*\*腿层/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /SOCKS 与 BOTTOM 分界/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /必须 BOTTOM/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /禁止擅自写成「打底裤\/贴身打底裤」/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /薄贴身速干\/发热内搭裤.*HEATTECH.*-15-4/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /薄贴身发热\/德绒内衣：-15-4/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /保暖内衣或裤内保暖层必须写明是内搭，不得推荐单穿\/当外层/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /电商\/淘宝模特图几乎总是单穿摆拍/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /禁止把光腿神器\/连裤袜\/羊羔绒袜型腿层标成 BOTTOM/);
    assert.match(WARDROBE_ANALYSIS_PROMPT, /禁止因「看起来像打底」就标 SOCKS/);

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
  it('moves 袜型打底裤 from BOTTOM to SOCKS', () => {
    assert.equal(coerceLegwearMainCategory('BOTTOM', '羊羔绒打底裤'), 'SOCKS');
    assert.equal(coerceLegwearMainCategory('BOTTOM', '加绒长款打底裤'), 'SOCKS');
    assert.equal(coerceLegwearMainCategory('BOTTOM', '光腿神器'), 'SOCKS');
  });

  it('keeps wearable yoga/sport tights as BOTTOM', () => {
    assert.equal(coerceLegwearMainCategory('BOTTOM', '瑜伽裤'), 'BOTTOM');
    assert.equal(coerceLegwearMainCategory('BOTTOM', '运动紧身长裤'), 'BOTTOM');
  });

  it('keeps 速干/发热内搭裤 as BOTTOM (pants sandwich inner)', () => {
    assert.equal(coerceLegwearMainCategory('BOTTOM', '速干保暖裤'), 'BOTTOM');
    assert.equal(coerceLegwearMainCategory('BOTTOM', '发热内衣裤'), 'BOTTOM');
    assert.equal(coerceLegwearMainCategory('BOTTOM', '滑雪底层裤'), 'BOTTOM');
    assert.equal(
      coerceLegwearMainCategory('BOTTOM', '贴身保暖裤', '薄速干面料，穿在外裤内'),
      'BOTTOM'
    );
  });

  it('recognizes plain fitted full-length fine-knit thermal pants without relying on a function word', () => {
    const description = '深灰混色弹力针织紧身长裤，高腰贴合腿部，表面有细密混色针织纹理，运动弹力面料。';
    assert.equal(looksLikeThermalInnerBottomPants('运动紧身长裤', description), true);
    assert.equal(coerceLegwearMainCategory('BOTTOM', '运动紧身长裤', description), 'BOTTOM');
    assert.deepEqual(
      sanitizeThermalInnerBottomFields('运动紧身长裤', description, 12, 23),
      { subCategory: '薄针织保暖长裤', tempMin: -15, tempMax: 4 }
    );
  });

  it('does not infer a thermal inner layer from concrete sportswear features', () => {
    assert.equal(
      looksLikeThermalInnerBottomPants('紧身长裤', '弹力针织长裤，侧边有反光条和拉链口袋。'),
      false
    );
  });

  it('does not treat explicitly absent pockets or belt loops as sportswear evidence', () => {
    assert.equal(
      looksLikeThermalInnerBottomPants(
        '运动紧身长裤',
        '细密平针织全长长裤，高腰贴合腿部，无口袋和裤袢。'
      ),
      true
    );
  });

  it('moves mislabeled HEATTECH/发热贴身打底裤 from SOCKS to BOTTOM', () => {
    assert.equal(
      coerceLegwearMainCategory(
        'SOCKS',
        '米白色贴身打底裤',
        '米白色贴身打底裤，HEATTECH 发热针织面料，柔软有弹力，裤脚收口贴合脚踝。'
      ),
      'BOTTOM'
    );
    assert.equal(coerceLegwearMainCategory('SOCKS', '发热保暖裤'), 'BOTTOM');
    assert.equal(coerceLegwearMainCategory('SOCKS', '发热打底裤'), 'BOTTOM');
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

  it('rewrites prod 发热打底裤 SOCKS into BOTTOM + thermal band', () => {
    const normalized = normalizeWardrobeAnalysis({
      mainCategory: 'SOCKS',
      subCategory: '发热打底裤',
      season: ['秋', '冬'],
      material: ['针织'],
      colors: ['米白'],
      tags: ['保暖', '打底', '贴身'],
      description:
        '米白色贴身长款打底裤，针织弹力面料平整无痕，腰头为同色细松紧，裤型紧贴腿部并延伸至脚踝。',
      searchDescription: '这条米白色发热打底裤是腿部的保暖底层',
      tempMin: 12,
      tempMax: 17,
    });
    assert.equal(normalized?.mainCategory, 'BOTTOM');
    assert.equal(normalized?.subCategory, '发热保暖裤');
    assert.equal(normalized?.tempMin, -15);
    assert.equal(normalized?.tempMax, 4);
  });

  it('rewrites 大圆领打底衫 TOP into 发热内衣 thermal band', () => {
    const normalized = normalizeWardrobeAnalysis({
      mainCategory: 'TOP',
      subCategory: '大圆领长袖打底衫',
      season: ['春', '秋'],
      material: ['弹力针织', '莫代尔'],
      colors: ['深灰'],
      tags: ['打底', '修身', '基础款'],
      description: '深灰色长袖打底衫，大圆领露出锁骨，针织弹力面料柔软服帖，版型收身不松垮。',
      tempMin: 16,
      tempMax: 23,
    });
    assert.equal(normalized?.mainCategory, 'TOP');
    assert.equal(normalized?.subCategory, '发热内衣');
    assert.equal(normalized?.tempMin, -15);
    assert.equal(normalized?.tempMax, 4);
  });

  it('rewrites 长袖大圆领T恤 with 打底 tags into 发热内衣', () => {
    const normalized = normalizeWardrobeAnalysis({
      mainCategory: 'TOP',
      subCategory: '长袖大圆领T恤',
      season: ['春', '秋'],
      material: ['细针织'],
      colors: ['浅米色'],
      tags: ['基础款', '打底', '修身'],
      description: '浅米色长袖T恤，大圆领修身剪裁，面料呈柔软细针织感。',
      tempMin: 16,
      tempMax: 23,
    });
    assert.equal(normalized?.subCategory, '发热内衣');
    assert.equal(normalized?.tempMin, -15);
    assert.equal(normalized?.tempMax, 4);
  });

  it('corrects an explicit thermal underwear top mislabeled as BOTTOM', () => {
    const normalized = normalizeWardrobeAnalysis({
      mainCategory: 'BOTTOM',
      subCategory: '发热内衣',
      description: '深灰色大圆领长袖上衣，薄弹力平针织面料，贴身修身。',
      tempMin: -15,
      tempMax: 4,
    });
    assert.equal(normalized?.mainCategory, 'TOP');
  });

  it('uses fitted long-sleeve neckline evidence to correct a mislabeled top category', () => {
    const normalized = normalizeWardrobeAnalysis({
      mainCategory: 'BOTTOM',
      subCategory: '大圆领长袖T恤',
      description: '深灰色大圆领长袖上衣，细密弹力针织，修身贴身。',
      tags: ['贴身内搭'],
      tempMin: 16,
      tempMax: 23,
    });
    assert.equal(normalized?.mainCategory, 'TOP');
    assert.equal(normalized?.subCategory, '发热内衣');
    assert.equal(normalized?.tempMin, -15);
    assert.equal(normalized?.tempMax, 4);
  });

  it('normalizes thermal inner-layer season, occasions and search semantics', () => {
    const top = normalizeWardrobeAnalysis({
      mainCategory: 'TOP',
      subCategory: '发热内衣',
      season: ['春', '秋'],
      material: ['针织'],
      colors: ['米色'],
      tags: ['基础款', '修身', '叠穿'],
      description: '米色大圆领长袖针织上衣，贴身修身。',
      occasions: ['休闲日常', '通勤'],
      searchDescription: '春秋可以单穿，下装搭配牛仔裤。',
      tempMin: 16,
      tempMax: 23,
    });
    assert.deepEqual(top?.season, ['autumn', 'winter']);
    assert.deepEqual(top?.occasions, ['寒冷天气', '冬季通勤']);
    assert.ok(top?.tags.includes('保暖'));
    assert.ok(top?.tags.includes('内搭'));
    assert.match(top?.searchDescription ?? '', /贴身保暖内层/);
    assert.doesNotMatch(top?.searchDescription ?? '', /单穿/);
    assert.equal(top?.tempMin, -15);
    assert.equal(top?.tempMax, 4);

    const bottom = normalizeWardrobeAnalysis({
      mainCategory: 'BOTTOM',
      subCategory: '运动紧身长裤',
      season: ['春', '秋'],
      material: ['针织'],
      colors: ['灰'],
      tags: ['修身'],
      description: '灰色细密平针织全长长裤，高腰贴合腿部，无口袋和裤袢。',
      occasions: ['日常休闲'],
      searchDescription: '适合单穿搭配裙装。',
      tempMin: 12,
      tempMax: 23,
    });
    assert.deepEqual(bottom?.occasions, ['寒冷天气', '冬季通勤']);
    assert.match(bottom?.searchDescription ?? '', /全长外裤里面/);
    assert.doesNotMatch(bottom?.searchDescription ?? '', /裙装|单穿/);
    assert.equal(bottom?.tempMin, -15);
    assert.equal(bottom?.tempMax, 4);
  });

  it('recognizes fitted large-neck thermal base tops without explicit HEATTECH text', () => {
    const samples = [
      {
        subCategory: '大圆领长袖T恤',
        description: '深灰色大圆领长袖上衣，弹力针织面料贴合身形，领口开阔露出锁骨。',
      },
      {
        subCategory: '大圆领薄针织长袖',
        description: '浅米色薄针织长袖，宽大圆领露出锁骨，衣身柔软贴肤、版型微收腰。',
      },
      {
        subCategory: '宽领长袖针织衫',
        description: '浅米色宽领长袖上衣，大圆领设计，修身剪裁，面料呈细密平针织纹理。',
      },
    ];

    for (const sample of samples) {
      const normalized = normalizeWardrobeAnalysis({
        mainCategory: 'TOP',
        ...sample,
        season: ['冬'],
        material: ['弹力针织'],
        colors: ['灰'],
        tags: [],
        tempMin: 16,
        tempMax: 23,
      });
      assert.equal(normalized?.mainCategory, 'TOP');
      assert.equal(normalized?.subCategory, '发热内衣');
      assert.equal(normalized?.tempMin, -15);
      assert.equal(normalized?.tempMax, 4);
    }
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
