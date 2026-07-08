/**
 * 对比「原始 query 向量」vs「格式化 query 向量」的检索分数变化。
 *
 * 用法：
 *   pnpm replay:rag-scores
 *   pnpm replay:rag-scores -- --limit 20
 */
import { config as loadEnv } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

loadEnv({ path: path.join(process.cwd(), '.env') });
loadEnv({ path: path.join(process.cwd(), '.env.local'), override: true });

import { searchWardrobeItemsByText } from '../server/services/wardrobeService';
import { parseWardrobeSearchSlot, resolveMainCategoryForSlot } from '../server/utils/ragSearchSlots';
import type { GatekeeperIntent } from '../server/agents/intent';

interface RagLogEntry {
  userId: string;
  intent?: GatekeeperIntent;
  perQueryResults?: Array<{
    query: string;
    slot?: string;
    mainCategory?: string;
    results?: Array<{ subCategory: string; similarity: number }>;
  }>;
}

interface ReplayCase {
  userId: string;
  query: string;
  slot?: string;
  intent?: GatekeeperIntent;
  loggedTop1?: number;
  loggedSubCategory?: string;
}

function loadCases(limit: number): ReplayCase[] {
  const logPath = path.join(process.cwd(), 'log/rag-search.jsonl');
  if (!fs.existsSync(logPath)) {
    throw new Error(`Missing ${logPath}`);
  }

  const seen = new Set<string>();
  const cases: ReplayCase[] = [];

  for (const line of fs.readFileSync(logPath, 'utf8').trim().split('\n')) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as RagLogEntry;
    for (const pq of entry.perQueryResults ?? []) {
      const query = pq.query?.trim();
      if (!query) continue;
      const key = `${entry.userId}::${pq.slot ?? ''}::${query}`;
      if (seen.has(key)) continue;
      seen.add(key);

      cases.push({
        userId: entry.userId,
        query,
        slot: pq.slot,
        intent: entry.intent,
        loggedTop1: pq.results?.[0]?.similarity,
        loggedSubCategory: pq.results?.[0]?.subCategory,
      });

      if (cases.length >= limit) return cases;
    }
  }

  return cases;
}

async function main() {
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 15;
  const cases = loadCases(limit);

  if (cases.length === 0) {
    console.log('No replay cases found.');
    return;
  }

  console.log(`Replaying ${cases.length} unique wardrobe search queries...\n`);

  let improved = 0;
  let regressed = 0;
  let unchanged = 0;
  let failed = 0;
  let oldTotal = 0;
  let newTotal = 0;
  let validCases = 0;

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  for (const [index, item] of cases.entries()) {
    const slot = parseWardrobeSearchSlot(item.slot);
    const mainCategory = resolveMainCategoryForSlot(item.slot);

    const oldResults = await searchWardrobeItemsByText(item.query, item.userId, 3, mainCategory, {
      slot,
      intent: item.intent,
      embedding: { useRawQueryEmbedding: true },
    });
    await sleep(900);

    const newResults = await searchWardrobeItemsByText(item.query, item.userId, 3, mainCategory, {
      slot,
      intent: item.intent,
    });
    await sleep(900);

    const oldTop = oldResults[0];
    const newTop = newResults[0];
    const oldScore = oldTop?.similarity ?? 0;
    const newScore = newTop?.similarity ?? 0;
    const delta = newScore - oldScore;
    const isValid = Boolean(oldTop || newTop);

    if (isValid) {
      validCases++;
      oldTotal += oldScore;
      newTotal += newScore;
      if (delta > 0.005) improved++;
      else if (delta < -0.005) regressed++;
      else unchanged++;
    } else {
      failed++;
    }

    console.log(
      [
        `#${index + 1}`,
        `slot=${item.slot ?? '-'}`,
        `query="${item.query.slice(0, 48)}${item.query.length > 48 ? '...' : ''}"`,
        `old=${oldScore.toFixed(3)} (${oldTop?.subCategory ?? 'none'})`,
        `new=${newScore.toFixed(3)} (${newTop?.subCategory ?? 'none'})`,
        `delta=${delta >= 0 ? '+' : ''}${delta.toFixed(3)}`,
        isValid ? '' : 'FAILED(quota/error)',
        item.loggedTop1 != null ? `logged=${item.loggedTop1.toFixed(3)}` : '',
      ]
        .filter(Boolean)
        .join(' | ')
    );
  }

  const avgOld = validCases > 0 ? oldTotal / validCases : 0;
  const avgNew = validCases > 0 ? newTotal / validCases : 0;

  console.log('\n--- Summary ---');
  console.log(`cases: ${cases.length}, valid: ${validCases}, failed: ${failed}`);
  console.log(`avg top1 similarity (valid only): old=${avgOld.toFixed(3)} new=${avgNew.toFixed(3)} delta=${(avgNew - avgOld).toFixed(3)}`);
  console.log(`improved: ${improved}, unchanged: ${unchanged}, regressed: ${regressed}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
