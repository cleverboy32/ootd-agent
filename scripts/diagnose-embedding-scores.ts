/**
 * 诊断 Doubao embedding 分数：对比 textEmbedding（纯文本）vs embedding（图文）列。
 *
 * 用法：pnpm diagnose:embedding-scores
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

loadEnv({ path: path.join(process.cwd(), '.env') });
loadEnv({ path: path.join(process.cwd(), '.env.local'), override: true });

import prismadb from '../server/db';
import {
  buildWardrobeDocumentEmbeddingText,
  buildWardrobeQueryEmbeddingText,
} from '../server/utils/embeddingText';
import { clothingItemToEmbeddingFields } from '../server/utils/wardrobeAnalysis';
import {
  generateTextEmbedding,
  generateVisualEmbedding,
} from '../server/services/embedding';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const clientId = process.env.OWNER_CLIENT_ID?.trim();
  if (!clientId) throw new Error('OWNER_CLIENT_ID is required');

  const items = await prismadb.clothingItem.findMany({
    where: { clientProfileId: clientId },
    take: 8,
    orderBy: { createdAt: 'desc' },
  });

  const queries = [
    { query: 'lightweight jacket or cardigan office commute layer', slot: 'outerwear' as const },
    { query: 'casual professional top office commute', slot: 'top' as const },
    { query: '白色裙子', slot: 'dress' as const },
  ];

  console.log(`[DIAG] EMBEDDING_MODEL=${process.env.EMBEDDING_MODEL}`);
  console.log(`[DIAG] EMBEDDING_VENDOR=${process.env.EMBEDDING_VENDOR}`);
  console.log(`[DIAG] Items in wardrobe: ${items.length}\n`);

  for (const it of items) {
    console.log(`  - ${it.subCategory} (${it.mainCategory}) | ${(it.description ?? '').slice(0, 55)}`);
  }

  for (const q of queries) {
    const qText = buildWardrobeQueryEmbeddingText(q.query, { slot: q.slot });
    const qVec = await generateTextEmbedding(qText);

    console.log(`\n=== Query: "${q.query}" ===`);
    console.log(`Formatted: ${qText.slice(0, 90)}...`);

    const rows: Array<{
      sub: string;
      cat: string;
      textLive: number;
      visualLive: number;
      storedText: number | null;
      storedVisual: number | null;
    }> = [];

    const vectorString = `[${qVec.join(',')}]`;

    for (const it of items) {
      const docText = buildWardrobeDocumentEmbeddingText(clothingItemToEmbeddingFields(it));
      const visualText = [it.subCategory, it.description ?? '', it.colors.join(', ')]
        .filter(Boolean)
        .join('. ');

      const textLiveVec = await generateTextEmbedding(docText);
      await sleep(400);
      const visualLiveVec = await generateVisualEmbedding(visualText, it.imageUrl);
      await sleep(400);

      const stored = await prismadb.$queryRaw<
        Array<{ text_sim: number | null; visual_sim: number | null }>
      >`
        SELECT
          CASE WHEN "textEmbedding" IS NOT NULL
            THEN 1 - ("textEmbedding" <=> ${vectorString}::vector)
            ELSE NULL END AS text_sim,
          CASE WHEN embedding IS NOT NULL
            THEN 1 - (embedding <=> ${vectorString}::vector)
            ELSE NULL END AS visual_sim
        FROM "ClothingItem"
        WHERE id = ${it.id}
      `;

      rows.push({
        sub: it.subCategory,
        cat: it.mainCategory,
        textLive: textLiveVec.reduce((acc, v, i) => acc + v * qVec[i], 0) /
          (Math.sqrt(textLiveVec.reduce((a, v) => a + v * v, 0)) *
            Math.sqrt(qVec.reduce((a, v) => a + v * v, 0))),
        visualLive: visualLiveVec.reduce((acc, v, i) => acc + v * qVec[i], 0) /
          (Math.sqrt(visualLiveVec.reduce((a, v) => a + v * v, 0)) *
            Math.sqrt(qVec.reduce((a, v) => a + v * v, 0))),
        storedText: stored[0]?.text_sim != null ? Number(stored[0].text_sim) : null,
        storedVisual: stored[0]?.visual_sim != null ? Number(stored[0].visual_sim) : null,
      });
    }

    rows.sort((a, b) => (b.storedText ?? b.textLive) - (a.storedText ?? a.textLive));

    console.log(
      '\n' +
        'subCategory'.padEnd(20) +
        'cat'.padEnd(12) +
        'textLive'.padEnd(10) +
        'visualLive'.padEnd(12) +
        'storedText'.padEnd(12) +
        'storedVisual'
    );
    for (const r of rows.slice(0, 6)) {
      console.log(
        r.sub.padEnd(20) +
          r.cat.padEnd(12) +
          r.textLive.toFixed(3).padEnd(10) +
          r.visualLive.toFixed(3).padEnd(12) +
          (r.storedText != null ? r.storedText.toFixed(3) : 'null').padEnd(12) +
          (r.storedVisual != null ? r.storedVisual.toFixed(3) : 'null')
      );
    }
  }
}

main()
  .then(async () => {
    await prismadb.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prismadb.$disconnect();
    process.exit(1);
  });
