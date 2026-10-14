import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadSkill } from '@/server/skills/loadSkill';

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
});
