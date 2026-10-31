import { readFileSync } from 'node:fs';
import path from 'node:path';

// 运行时按 cwd 读取：依赖 `next start` 全仓部署；改 standalone 需在 next.config 的 outputFileTracingIncludes 声明 server/skills/*.md
const SKILLS_DIR = path.join(process.cwd(), 'server', 'skills');

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

const bodyCache = new Map<string, string>();
const descriptionCache = new Map<string, string>();

function readSkillRaw(name: string): string {
  try {
    return readFileSync(path.join(SKILLS_DIR, `${name}.md`), 'utf8');
  } catch (error) {
    throw new Error(`Skill not found: ${name}`, { cause: error });
  }
}

export function loadSkill(name: string): string {
  const cached = bodyCache.get(name);
  if (cached !== undefined) return cached;

  const raw = readSkillRaw(name);
  const body = raw.replace(FRONTMATTER, '').trim();
  bodyCache.set(name, body);
  return body;
}

/** frontmatter 里的 description；没有则空字符串。 */
export function loadSkillDescription(name: string): string {
  const cached = descriptionCache.get(name);
  if (cached !== undefined) return cached;

  const raw = readSkillRaw(name);
  const match = raw.match(FRONTMATTER);
  const block = match?.[1] ?? '';
  const line = block.match(/^description:\s*(.*)$/m);
  const description = line?.[1]?.trim() ?? '';
  descriptionCache.set(name, description);
  return description;
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
