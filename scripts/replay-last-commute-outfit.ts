/**
 * Replay 「今天上班穿啥」 for the Chongqing wardrobe user — Plan→RAG→Reconcile only.
 *
 *   pnpm exec dotenv -e .env -e .env.local -- tsx scripts/replay-last-commute-outfit.ts
 *   REPLAY_N=3 pnpm exec dotenv -e .env -e .env.local -- tsx scripts/replay-last-commute-outfit.ts
 */
import { ClothingItem } from '@prisma/client';
import { normalizeGatekeeperIntent } from '@/server/agents/intent';
import { callStylistAgent } from '@/server/agents/stylist/agent';
import { loadUserProfileFromDb } from '@/server/agents/user-profile/agent';
import { clearSkillCaches } from '@/server/skills/loadSkill';

const USER_ID = 'cmv3mqdxe0001bqs8bc5nsmmx';
const MESSAGE = '今天上班穿啥';
const N = Math.max(1, Number(process.env.REPLAY_N ?? '1') || 1);

async function runOnce(run: number) {
  clearSkillCaches();
  const profile = await loadUserProfileFromDb(USER_ID);
  const intent = normalizeGatekeeperIntent({
    request_type: 'wardrobe_outfit',
    weather: '重庆，阴，15℃，西南风2级，湿度63%',
    city: '重庆',
    occasion: '上班通勤',
    dressing_climate: 'mild',
    style_preference: '',
    special_requests: '',
  });

  const ragCache = new Map<string, ClothingItem>();
  const result = await callStylistAgent(
    [],
    intent,
    profile,
    [{ text: MESSAGE }],
    USER_ID,
    ragCache,
    `replay-commute-${run}`
  );

  const outfit = result.outfits[0];
  console.log(`\n=== REPLAY RESULT #${run}/${N} ===`);
  console.log('concept:', outfit?.overall_concept);
  let wardrobe = 0;
  let neu = 0;
  for (const item of outfit?.selected_items ?? []) {
    const isWardrobe = item.id !== 'new_item' && !String(item.id).startsWith('new_');
    if (isWardrobe) wardrobe++;
    else neu++;
    console.log(
      `- ${item.layer}: ${isWardrobe ? 'WARDROBE' : 'new_item'} id=${item.id} name=${item.name}`
    );
  }
  console.log(`summary: wardrobe=${wardrobe} new_item=${neu} cacheSize=${ragCache.size}`);
}

async function main() {
  for (let i = 1; i <= N; i++) {
    await runOnce(i);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});