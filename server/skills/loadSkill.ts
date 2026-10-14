import { readFileSync } from 'node:fs';
import path from 'node:path';

// 运行时按 cwd 读取：依赖 `next start` 全仓部署；改 standalone 需在 next.config 的 outputFileTracingIncludes 声明 server/skills/*.md
const SKILLS_DIR = path.join(process.cwd(), 'server', 'skills');

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

const cache = new Map<string, string>();

export function loadSkill(name: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  let raw: string;
  try {
    raw = readFileSync(path.join(SKILLS_DIR, `${name}.md`), 'utf8');
  } catch (error) {
    throw new Error(`Skill not found: ${name}`, { cause: error });
  }

  const body = raw.replace(FRONTMATTER, '').trim();
  cache.set(name, body);
  return body;
}
