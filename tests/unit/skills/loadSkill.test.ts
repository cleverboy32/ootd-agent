import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeGatekeeperIntent } from '@/server/agents/intent';
import { STYLIST_SYSTEM_INSTRUCTION } from '@/server/agents/stylist/prompts';
import {
  filterSkillsForWardrobeSearch,
  listStylistSelectableSkills,
  normalizeStylistSkillNames,
  selectStylistOutfitSkillNames,
  STYLIST_SELECTABLE_SKILL_NAMES,
} from '@/server/agents/stylist/skillSelection';
import {
  buildSkillBlocks,
  extractRetrievalSection,
  loadSkill,
  loadSkillDescription,
} from '@/server/skills/loadSkill';

describe('loadSkill', () => {
  it('weather-dressing：返回正文且去掉 frontmatter', () => {
    const body = loadSkill('weather-dressing');
    assert.ok(body.length > 0);
    assert.doesNotMatch(body, /^---/);
    assert.doesNotMatch(body, /^name:/m);
    assert.doesNotMatch(body, /^description:/m);
  });

  it('weather-dressing：包含温度档位与修正项两节', () => {
    const body = loadSkill('weather-dressing');
    assert.match(body, /## 温度档位/);
    assert.match(body, /## 修正项/);
  });

  it('不存在的 skill 抛出含名称的错误', () => {
    assert.throws(() => loadSkill('no-such-skill'), /no-such-skill/);
  });

  it('二次调用返回同一缓存结果', () => {
    assert.equal(loadSkill('weather-dressing'), loadSkill('weather-dressing'));
  });

  it('athletic-outfit：返回正文且去掉 frontmatter', () => {
    const body = loadSkill('athletic-outfit');
    assert.ok(body.length > 0);
    assert.doesNotMatch(body, /^---/);
    assert.doesNotMatch(body, /^name:/m);
    assert.match(body, /Wrap Shorts/);
    assert.match(body, /athletic \/ sports \/ breathable \/ training/);
    assert.match(body, /sports shorts/);
  });
});

describe('loadSkillDescription', () => {
  it('搭配 skill 的 description 写成何时选，不是正文规则摘要', () => {
    assert.match(loadSkillDescription('style-sweet'), /甜美|甜妹|少女感/);
    assert.doesNotMatch(loadSkillDescription('style-sweet'), /只放在一个位置/);

    assert.match(loadSkillDescription('style-history'), /汉服|考据|朝代/);
    assert.doesNotMatch(loadSkillDescription('style-history'), /国风|古风/);

    assert.match(loadSkillDescription('athletic-outfit'), /运动|训练|瑜伽/);
  });
});

describe('extractRetrievalSection', () => {
  it('抽出 ## 检索 节，不含前后其它节', () => {
    const body = `## 何时用\n说明\n\n## 检索\n- 上：短上衣\n- 下：高腰\n\n## 穿搭\n别的规则\n`;
    assert.equal(extractRetrievalSection(body), '- 上：短上衣\n- 下：高腰');
  });

  it('抽出 ## N. 检索生成逻辑 节', () => {
    const body = `## 5. 配饰\n别的\n\n## 6. 检索生成逻辑 (Search)\n- 上：短上衣\n- 下：高腰\n`;
    assert.equal(extractRetrievalSection(body), '- 上：短上衣\n- 下：高腰');
  });

  it('没有检索节时返回全文', () => {
    const body = '## 穿搭\n整段规则';
    assert.equal(extractRetrievalSection(body), body);
  });

  it('真实 style-korean skill 含检索节内容', () => {
    const section = extractRetrievalSection(loadSkill('style-korean'));
    assert.ok(section.length > 0);
    assert.ok(section.length < loadSkill('style-korean').length);
    assert.match(section, /短|高腰|检索|上|下|鞋/);
  });
});

describe('filterSkillsForWardrobeSearch', () => {
  it('检索只保留风格/天气/运动/新品 skill，去掉身形与色彩', () => {
    assert.deepEqual(
      filterSkillsForWardrobeSearch([
        'style-korean',
        'weather-dressing',
        'body-petite',
        'color-aesthetics',
        'color-warm',
        'athletic-outfit',
        'outfit-design',
      ]),
      ['style-korean', 'weather-dressing', 'athletic-outfit', 'outfit-design']
    );
  });
});

describe('normalizeStylistSkillNames', () => {
  it('剔除非白名单与重复', () => {
    assert.deepEqual(
      normalizeStylistSkillNames(['style-sweet', 'no-such', 'style-sweet', ' athletic-outfit ']),
      ['style-sweet', 'athletic-outfit']
    );
  });

  it('风格只留第一个', () => {
    assert.deepEqual(normalizeStylistSkillNames(['style-cool', 'style-sweet', 'weather-dressing']), [
      'style-cool',
      'weather-dressing',
    ]);
  });

  it('梨形与苹果形冲突时只留先出现的', () => {
    assert.deepEqual(normalizeStylistSkillNames(['body-pear', 'body-apple', 'body-petite']), [
      'body-pear',
      'body-petite',
    ]);
    assert.deepEqual(normalizeStylistSkillNames(['body-apple', 'body-pear']), ['body-apple']);
  });

  it('冷暖中性只留一个，并自动补 color-aesthetics', () => {
    assert.deepEqual(normalizeStylistSkillNames(['color-warm', 'color-cool']), [
      'color-aesthetics',
      'color-warm',
    ]);
    assert.deepEqual(normalizeStylistSkillNames(['color-aesthetics', 'color-neutral']), [
      'color-aesthetics',
      'color-neutral',
    ]);
  });

  it('白名单目录可加载正文', () => {
    const catalog = listStylistSelectableSkills();
    assert.equal(catalog.length, STYLIST_SELECTABLE_SKILL_NAMES.length);
    for (const entry of catalog) {
      assert.ok(entry.description.length > 0, entry.name);
      assert.ok(loadSkill(entry.name).length > 0, entry.name);
    }
    assert.ok(buildSkillBlocks(['style-history', 'weather-dressing']).includes('【技能 style-history】'));
  });

  it('未知技能名抛出含名称的错误', () => {
    assert.throws(() => buildSkillBlocks(['no-such-skill']), /no-such-skill/);
  });
});

describe('selectStylistOutfitSkillNames', () => {
  function block(requestType: 'purchase_pairing' | 'wardrobe_pairing' | 'feedback_revision' | 'wardrobe_outfit') {
    return buildSkillBlocks(
      selectStylistOutfitSkillNames(normalizeGatekeeperIntent({ request_type: requestType }))
    );
  }

  it('三种搭配模式各只注入对应技能', () => {
    const purchase = block('purchase_pairing');
    assert.match(purchase, /【技能 stylist-purchase-pairing】/);
    assert.doesNotMatch(purchase, /wardrobe-pairing|feedback-revision/);

    const wardrobe = block('wardrobe_pairing');
    assert.match(wardrobe, /【技能 stylist-wardrobe-pairing】/);
    assert.match(wardrobe, /衣橱锚定搭配模式/);
    assert.doesNotMatch(wardrobe, /purchase-pairing|feedback-revision/);

    const revision = block('feedback_revision');
    assert.match(revision, /【技能 stylist-feedback-revision】/);
    assert.match(revision, /多轮对话与反馈微调模式/);
    assert.doesNotMatch(revision, /purchase-pairing|wardrobe-pairing/);
  });

  it('wardrobe_outfit 不注入搭配模式', () => {
    assert.equal(block('wardrobe_outfit'), '');
  });

  it('主提示词不再包含三种模式标题', () => {
    assert.doesNotMatch(STYLIST_SYSTEM_INSTRUCTION, /待购单品搭配模式/);
    assert.doesNotMatch(STYLIST_SYSTEM_INSTRUCTION, /衣橱锚定搭配模式/);
    assert.doesNotMatch(STYLIST_SYSTEM_INSTRUCTION, /反馈微调模式 feedback_revision/);
    assert.doesNotMatch(STYLIST_SYSTEM_INSTRUCTION, /多轮对话与反馈微调模式/);
    assert.match(STYLIST_SYSTEM_INSTRUCTION, /新品的 description 必填一句外观/);
    assert.match(STYLIST_SYSTEM_INSTRUCTION, /鞋写鞋头、鞋面、鞋底/);
    assert.match(STYLIST_SYSTEM_INSTRUCTION, /禁止只改 name/);
    assert.match(STYLIST_SYSTEM_INSTRUCTION, /整套都用 new_item/);
    assert.match(loadSkill('stylist-feedback-revision'), /气质\/品类纠偏|禁止只改 name/);
    assert.match(STYLIST_SYSTEM_INSTRUCTION, /有色彩技能时，脸周颜色、深浅和面积按技能/);
    assert.doesNotMatch(STYLIST_SYSTEM_INSTRUCTION, /其余槽位用衣橱/);
    assert.doesNotMatch(STYLIST_SYSTEM_INSTRUCTION, /衣橱里已有该季节的外套就用衣橱/);
  });
});
