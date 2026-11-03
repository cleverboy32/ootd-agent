import { readFileSync } from 'node:fs';
import path from 'node:path';

// 运行时按 cwd 读取：依赖 `next start` 全仓部署；改 standalone 需在 next.config 的 outputFileTracingIncludes 声明 server/skills/*.md
const SKILLS_DIR = path.join(process.cwd(), 'server', 'skills');

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

const bodyCache = new Map<string, string>();
const descriptionCache = new Map<string, string>();

/**
 * A/B：STYLE_SKILL_VARIANT=baseline 时从 variants/baseline/ 读快照；
 * 默认读 server/skills/*.md（现行 Menu 改写）。
 */
function resolveSkillFilePath(name: string): string {
  const variant = process.env.STYLE_SKILL_VARIANT?.trim().toLowerCase();
  if (variant === 'baseline') {
    return path.join(SKILLS_DIR, 'variants', 'baseline', `${name}.md`);
  }
  return path.join(SKILLS_DIR, `${name}.md`);
}

function readSkillRaw(name: string): string {
  const primary = resolveSkillFilePath(name);
  try {
    return readFileSync(primary, 'utf8');
  } catch (primaryError) {
    if (process.env.STYLE_SKILL_VARIANT?.trim()) {
      try {
        return readFileSync(path.join(SKILLS_DIR, `${name}.md`), 'utf8');
      } catch {
        /* fall through */
      }
    }
    throw new Error(`Skill not found: ${name}`, { cause: primaryError });
  }
}

export function loadSkill(name: string): string {
  const variant = process.env.STYLE_SKILL_VARIANT?.trim().toLowerCase() || 'default';
  const cacheKey = `${variant}:${name}`;
  const cached = bodyCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const raw = readSkillRaw(name);
  const body = raw.replace(FRONTMATTER, '').trim();
  bodyCache.set(cacheKey, body);
  return body;
}

/** frontmatter 里的 description；没有则空字符串。 */
export function loadSkillDescription(name: string): string {
  const variant = process.env.STYLE_SKILL_VARIANT?.trim().toLowerCase() || 'default';
  const cacheKey = `${variant}:${name}`;
  const cached = descriptionCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const raw = readSkillRaw(name);
  const match = raw.match(FRONTMATTER);
  const block = match?.[1] ?? '';
  const line = block.match(/^description:\s*(.*)$/m);
  const description = line?.[1]?.trim() ?? '';
  descriptionCache.set(cacheKey, description);
  return description;
}

/** 测试/脚本用：清空 skill 正文缓存（切换 STYLE_SKILL_VARIANT 后调用）。 */
export function clearSkillCaches(): void {
  bodyCache.clear();
  descriptionCache.clear();
}

/** 按给定顺序拼接技能正文。空名单返回空字符串；未知名字沿用 loadSkill 抛错。 */
export function buildSkillBlocks(names: string[]): string {
  if (names.length === 0) return '';
  return names
    .map((name) => `\n【技能 ${name}】\n${loadSkill(name)}\n`)
    .join('');
}

/** 抽出 skill 正文里的「检索」节；没有该节则返回全文。兼容 `## 检索` 与 `## 6. 检索生成逻辑`。 */
export function extractRetrievalSection(skillBody: string): string {
  const body = skillBody.trim();
  if (!body) return '';
  const match = body.match(/##\s*(?:\d+\.\s*)?检索[^\n]*\r?\n([\s\S]*?)(?=\r?\n##\s|$)/);
  return (match?.[1] ?? body).trim();
}
