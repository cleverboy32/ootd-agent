/**
 * 同会话两轮「今天上班穿啥」：验证 history 精简方案 + prior 多样性避重。
 *
 *   pnpm exec dotenv -e .env -e .env.local -- tsx scripts/replay-commute-diversity.ts
 *   MODE=redo pnpm exec dotenv -e .env -e .env.local -- tsx scripts/replay-commute-diversity.ts
 *
 * MODE=repeat（默认）：第 2 轮仍是 wardrobe_outfit（反复同要求）
 * MODE=redo：第 2 轮改为 outfit_redo（明确重做）
 */
import type { Content } from '@google/genai';
import { ClothingItem } from '@prisma/client';
import { normalizeGatekeeperIntent } from '@/server/agents/intent';
import { callStylistAgent } from '@/server/agents/stylist/agent';
import type { StylistResult } from '@/server/agents/stylist/schema';
import { loadUserProfileFromDb } from '@/server/agents/user-profile/agent';
import { clearSkillCaches } from '@/server/skills/loadSkill';
import { formatStylistResultForHistory } from '@/server/utils/messageContent';

const USER_ID = 'cmv3mqdxe0001bqs8bc5nsmmx';
const MESSAGE = '今天上班穿啥';
const MODE = (process.env.MODE ?? 'repeat').trim().toLowerCase() === 'redo' ? 'redo' : 'repeat';

function summarize(label: string, result: StylistResult) {
  const outfit = result.outfits[0];
  console.log(`\n=== ${label} ===`);
  console.log('concept:', outfit?.overall_concept);
  for (const item of outfit?.selected_items ?? []) {
    const src = item.id === 'new_item' || String(item.id).startsWith('new_') ? 'new' : 'wardrobe';
    console.log(`- ${item.layer}: ${item.name} (${src})`);
  }
}

function slotMap(result: StylistResult): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of result.outfits[0]?.selected_items ?? []) {
    out[item.layer] = item.name?.trim() || '';
  }
  return out;
}

async function main() {
  clearSkillCaches();
  const profile = await loadUserProfileFromDb(USER_ID);
  const baseIntent = normalizeGatekeeperIntent({
    request_type: 'wardrobe_outfit',
    weather: '重庆，阴，15℃，西南风2级，湿度63%',
    city: '重庆',
    occasion: '上班通勤',
    dressing_climate: 'mild',
    style_preference: '',
    special_requests: '',
  });

  const conversationId = `replay-diversity-${Date.now()}`;
  console.log(`conversationId=${conversationId} MODE=${MODE}`);

  const rag1 = new Map<string, ClothingItem>();
  const turn1 = await callStylistAgent(
    [],
    baseIntent,
    profile,
    [{ text: MESSAGE }],
    USER_ID,
    rag1,
    conversationId,
    { messageId: `${conversationId}-m1` }
  );
  summarize('TURN 1 (cold start, no prior)', turn1);

  const historyText = formatStylistResultForHistory(turn1);
  console.log('\n--- history model text (compact) ---\n' + historyText);

  const history: Content[] = [
    { role: 'user', parts: [{ text: MESSAGE }] },
    { role: 'model', parts: [{ text: historyText }] },
  ];

  const turn2Intent =
    MODE === 'redo'
      ? normalizeGatekeeperIntent({
          ...baseIntent,
          request_type: 'outfit_redo',
          special_requests: '重新生成，换一套',
        })
      : baseIntent;

  const turn2Message = MODE === 'redo' ? '不满意，重新生成一套' : MESSAGE;

  const rag2 = new Map<string, ClothingItem>();
  const turn2 = await callStylistAgent(
    history,
    turn2Intent,
    profile,
    [{ text: turn2Message }],
    USER_ID,
    rag2,
    conversationId,
    {
      messageId: `${conversationId}-m2`,
      priorStylistResults: [turn1],
    }
  );
  summarize(
    MODE === 'redo' ? 'TURN 2 (outfit_redo + prior)' : 'TURN 2 (wardrobe_outfit + prior)',
    turn2
  );

  const a = slotMap(turn1);
  const b = slotMap(turn2);
  const layers = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
  console.log('\n=== DIFF (name by layer) ===');
  let same = 0;
  let changed = 0;
  for (const layer of layers) {
    const left = a[layer] || '—';
    const right = b[layer] || '—';
    const mark = left === right ? 'SAME' : 'CHANGED';
    if (left === right) same++;
    else changed++;
    console.log(`${mark} ${layer}: ${left} → ${right}`);
  }
  console.log(`summary: same=${same} changed=${changed}`);
  if (changed === 0) {
    console.warn('WARN: turn2 looks identical — diversity may not have bitten.');
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
