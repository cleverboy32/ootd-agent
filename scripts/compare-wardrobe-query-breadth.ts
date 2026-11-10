/**
 * Compare fine (production) vs coarse wardrobe queries for the same user/slot.
 *
 * Usage:
 *   pnpm compare:wardrobe-breadth
 *   pnpm compare:wardrobe-breadth -- --userId=<id>
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

loadEnv({ path: path.join(process.cwd(), '.env') });
loadEnv({ path: path.join(process.cwd(), '.env.local'), override: true });

import { searchWardrobeItemsByText } from '../server/services/wardrobeService';
import { parseWardrobeSearchSlot, resolveMainCategoryForSlot } from '../server/utils/ragSearchSlots';
import { broadenWardrobeQuery } from '../server/utils/broadenWardrobeQuery';

/** Recent empty-recall cases from ootd-agent logs (约会 / 上班). */
const FIXTURES: Array<{ userId: string; slot: string; fine: string; note: string }> = [
  {
    userId: 'cmw92oewp004eo2s809zalf72',
    slot: 'top',
    fine: '修身针织毛衣 米白',
    note: '成都约会',
  },
  {
    userId: 'cmw92oewp004eo2s809zalf72',
    slot: 'bottom',
    fine: '高腰A字半身裙 藏蓝',
    note: '成都约会',
  },
  {
    userId: 'cmw92oewp004eo2s809zalf72',
    slot: 'outerwear',
    fine: '羊毛大衣 灰粉',
    note: '成都约会',
  },
  {
    userId: 'cmw92oewp004eo2s809zalf72',
    slot: 'shoes',
    fine: '粗跟短靴 黑色',
    note: '成都约会',
  },
  {
    userId: 'cmv3mqdxr0000hgb6example', // placeholder — overwritten below from real ids
    slot: 'top',
    fine: '灰粉色高领修身针织上衣',
    note: '重庆约会',
  },
];

/** Empty-wardrobe user (SQL raw []) + user with ragItemCount=2 on Nov 10. */
const CASES: Array<{ userId: string; slot: string; fine: string; note: string }> = [
  {
    userId: 'cmw92oewp004eo2s809zalf72',
    slot: 'top',
    fine: '修身针织毛衣 米白',
    note: 'empty-wardrobe-user',
  },
  {
    userId: 'cmw92oewp004eo2s809zalf72',
    slot: 'bottom',
    fine: '高腰A字半身裙 藏蓝',
    note: 'empty-wardrobe-user',
  },
  {
    userId: 'cmv3mqdxe0001bqs8bc5nsmmx',
    slot: 'top',
    fine: '灰粉色高领修身针织上衣',
    note: 'has-wardrobe-重庆约会',
  },
  {
    userId: 'cmv3mqdxe0001bqs8bc5nsmmx',
    slot: 'bottom',
    fine: '灰白色高腰A字半身裙',
    note: 'has-wardrobe-重庆约会',
  },
  {
    userId: 'cmv3mqdxe0001bqs8bc5nsmmx',
    slot: 'outerwear',
    fine: '米白色短款斜纹软呢外套',
    note: 'has-wardrobe-重庆约会',
  },
  {
    userId: 'cmv3mqdxe0001bqs8bc5nsmmx',
    slot: 'shoes',
    fine: '米白色玛丽珍粗跟鞋',
    note: 'has-wardrobe-重庆约会',
  },
  {
    userId: 'cmv3mqdxe0001bqs8bc5nsmmx',
    slot: 'top',
    fine: '米白色短款针织衫 微阔肩 长袖',
    note: 'has-wardrobe-重庆上班',
  },
  {
    userId: 'cmv3mqdxe0001bqs8bc5nsmmx',
    slot: 'bottom',
    fine: '高腰A字半身裙 灰粉 中长',
    note: 'has-wardrobe-重庆上班',
  },
  {
    userId: 'cmv3mqdxe0001bqs8bc5nsmmx',
    slot: 'shoes',
    fine: '米白色乐福鞋 低跟',
    note: 'has-wardrobe-重庆上班',
  },
  {
    userId: 'cmv3mqdxe0001bqs8bc5nsmmx',
    slot: 'outerwear',
    fine: '浅灰色短款开衫 薄款',
    note: 'has-wardrobe-重庆上班',
  },
];

void FIXTURES;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const userArg = process.argv.find((a) => a.startsWith('--userId='));
  const onlyUser = userArg?.split('=')[1];
  const cases = onlyUser ? CASES.filter((c) => c.userId === onlyUser) : CASES;

  console.log(`Comparing fine vs coarse wardrobe queries (${cases.length} cases)...\n`);

  let fineHits = 0;
  let coarseHits = 0;
  let fineZeroCoarseHit = 0;
  let bothZero = 0;

  for (const [i, c] of cases.entries()) {
    const coarse = broadenWardrobeQuery(c.fine);
    const slot = parseWardrobeSearchSlot(c.slot);
    const mainCategory = resolveMainCategoryForSlot(c.slot);

    const fineResults = await searchWardrobeItemsByText(c.fine, c.userId, 5, mainCategory, {
      slot,
    });
    await sleep(400);
    const coarseResults =
      coarse === c.fine
        ? fineResults
        : await searchWardrobeItemsByText(coarse, c.userId, 5, mainCategory, { slot });
    if (coarse !== c.fine) await sleep(400);

    const fN = fineResults.length;
    const cN = coarseResults.length;
    if (fN > 0) fineHits++;
    if (cN > 0) coarseHits++;
    if (fN === 0 && cN > 0) fineZeroCoarseHit++;
    if (fN === 0 && cN === 0) bothZero++;

    const fTop = fineResults[0];
    const cTop = coarseResults[0];
    console.log(
      [
        `#${i + 1}`,
        c.note,
        `slot=${c.slot}`,
        `fine="${c.fine}" → hits=${fN}` +
          (fTop ? ` top=${fTop.subCategory}@${fTop.similarity.toFixed(3)}` : ''),
        `coarse="${coarse}" → hits=${cN}` +
          (cTop ? ` top=${cTop.subCategory}@${cTop.similarity.toFixed(3)}` : ''),
        fN === 0 && cN > 0 ? 'UPGRADE' : fN > 0 && cN === 0 ? 'REGRESS' : '',
      ]
        .filter(Boolean)
        .join(' | ')
    );
  }

  console.log('\n--- Summary ---');
  console.log(`cases: ${cases.length}`);
  console.log(`fine hits (>0): ${fineHits}/${cases.length}`);
  console.log(`coarse hits (>0): ${coarseHits}/${cases.length}`);
  console.log(`fine=0 but coarse>0 (UPGRADE): ${fineZeroCoarseHit}`);
  console.log(`both zero: ${bothZero}`);
  if (fineZeroCoarseHit > 0) {
    console.log('Conclusion: coarse query improves recall on at least some empty fine slots.');
  } else if (coarseHits > fineHits) {
    console.log('Conclusion: coarse has more hit slots overall.');
  } else if (bothZero === cases.length) {
    console.log(
      'Conclusion: both fine and coarse returned 0 — check wardrobe inventory / temp filters, not query narrowness alone.'
    );
  } else {
    console.log('Conclusion: coarse did not clearly beat fine on this fixture set.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
