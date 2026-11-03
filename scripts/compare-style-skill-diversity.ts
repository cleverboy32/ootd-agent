/**
 * 风格 skill A/B：Baseline（variants/baseline）vs Menu（现行 skills）。
 *
 * 用法：
 *   pnpm exec dotenv -e .env -e .env.local -- tsx scripts/compare-style-skill-diversity.ts
 *   STYLE_AB_N=3 STYLE_AB_ARMS=baseline,menu tsx ...
 *
 * 只跑 Plan 阶段（定骨架），不落库、不出图。结果：log/skill-ab/
 */
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { clearSkillCaches } from '@/server/skills/loadSkill';
import { planOutfitsAndQueries } from '@/server/agents/stylist/agent';
import { normalizeGatekeeperIntent } from '@/server/agents/intent';
import type { UserProfileResult } from '@/server/agents/user-profile/schema';
import { fingerprintOutfit } from '@/server/agents/stylist/newItemDiversity';

const N = Math.max(1, Number(process.env.STYLE_AB_N ?? '5') || 5);
const ARMS = (process.env.STYLE_AB_ARMS ?? 'baseline,menu')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const PROFILE: UserProfileResult = {
  name: '',
  height: '',
  weight: '',
  gender: '男',
  preferences: [],
  skin_tone: '',
  body_shape: '',
  personal_style: '',
  visual_features: { hair_color: '', detected_features: '' },
};

type Scenario = {
  id: string;
  skill: string;
  message: string;
  intent: ReturnType<typeof normalizeGatekeeperIntent>;
};

const SCENARIOS: Scenario[] = [
  {
    id: 'history_wuxia_first',
    skill: 'style-history',
    message: '帮我搭一套侠客风汉服逛街',
    intent: normalizeGatekeeperIntent({
      request_type: 'wardrobe_outfit',
      occasion: '逛街',
      style_preference: '侠客风汉服',
      dressing_climate: 'mild',
    }),
  },
  {
    id: 'history_wuxia_redo',
    skill: 'style-history',
    message: '重新搭配一套',
    intent: normalizeGatekeeperIntent({
      request_type: 'outfit_redo',
      occasion: '逛街',
      style_preference: '侠客风汉服',
      dressing_climate: 'mild',
      special_requests: '整套重做侠客风，换形制分支，不要和上一套一样',
    }),
  },
  {
    id: 'history_reject_duanzao',
    skill: 'style-history',
    message: '不要短打店小二感，换长袍',
    intent: normalizeGatekeeperIntent({
      request_type: 'outfit_redo',
      occasion: '逛街',
      style_preference: '侠客风汉服',
      dressing_climate: 'mild',
      special_requests: '避开短打店小二，向长身外袍或武官式收腰方向',
    }),
  },
  {
    id: 'korean_commute',
    skill: 'style-korean',
    message: '韩系通勤一套',
    intent: normalizeGatekeeperIntent({
      request_type: 'wardrobe_outfit',
      occasion: '通勤',
      style_preference: '韩系',
      dressing_climate: 'mild',
    }),
  },
];

function branchFromConcept(concept: string): string {
  const m = concept.match(/(?:形制|路径)\s*[=：:]\s*([^\s，,；;|/]+)/);
  if (m?.[1]) return m[1];
  if (/短打/.test(concept)) return '短打(推断)';
  if (/长身|长袍|战袍/.test(concept)) return '长袍(推断)';
  if (/圆领/.test(concept)) return '圆领(推断)';
  if (/褙子/.test(concept)) return '褙子(推断)';
  return '未点名';
}

function hardBanHits(text: string): string[] {
  const hits: string[] = [];
  if (/短袖|五分袖|七分袖/.test(text)) hits.push('短袖风险');
  if (/牛仔裤|卫衣|运动鞋/.test(text)) hits.push('现代混搭');
  if (/及膝|露腿|光腿/.test(text)) hits.push('露腿风险');
  return hits;
}

async function runArm(arm: string) {
  process.env.STYLE_SKILL_VARIANT = arm === 'menu' ? '' : arm;
  clearSkillCaches();

  const outDir = path.join(process.cwd(), 'log', 'skill-ab', arm || 'menu');
  mkdirSync(outDir, { recursive: true });
  const summary: Array<Record<string, unknown>> = [];

  for (const scenario of SCENARIOS) {
    const concepts: string[] = [];
    const branches = new Set<string>();
    const fingerprints = new Set<string>();
    let banCount = 0;

    for (let i = 0; i < N; i++) {
      const { plan } = await planOutfitsAndQueries(
        [],
        scenario.intent,
        PROFILE,
        scenario.message,
        null,
        undefined,
        [],
        [scenario.skill],
        { messageId: `${scenario.id}-${arm}-${i}` }
      );
      const outfit = plan.outfits[0];
      const concept = outfit?.overall_concept ?? '';
      const slotsBlob = (outfit?.slots ?? [])
        .map((s) => `${s.slot}:${s.target}|${s.search_query}`)
        .join('; ');
      const blob = `${concept} ${slotsBlob}`;
      const branch = branchFromConcept(concept);
      const fp = fingerprintOutfit({
        overall_concept: concept,
        selected_items: (outfit?.slots ?? []).map((s) => ({
          id: 'new_item',
          name: s.target,
          layer: s.slot,
          reason: '',
        })),
      });
      const bans = hardBanHits(blob);
      banCount += bans.length > 0 ? 1 : 0;
      concepts.push(concept);
      branches.add(branch);
      fingerprints.add(fp);

      const line = JSON.stringify({
        arm: arm || 'menu',
        scenario: scenario.id,
        run: i,
        overall_concept: concept,
        branch,
        fingerprint: fp,
        slots: outfit?.slots,
        bans,
      });
      appendFileSync(path.join(outDir, `${scenario.id}.jsonl`), line + '\n');
      console.log(`[${arm || 'menu'}] ${scenario.id}#${i} branch=${branch} fp=${fp}`);
    }

    summary.push({
      arm: arm || 'menu',
      scenario: scenario.id,
      n: N,
      uniqueBranches: branches.size,
      branches: [...branches],
      uniqueFingerprints: fingerprints.size,
      hardBanRuns: banCount,
      sampleConcepts: concepts.slice(0, 3),
    });
  }

  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  const all: Array<Record<string, unknown>> = [];
  for (const arm of ARMS) {
    console.log(`\n=== arm=${arm} N=${N} ===`);
    all.push(...(await runArm(arm === 'menu' ? 'menu' : arm)));
  }
  const rollupPath = path.join(process.cwd(), 'log', 'skill-ab', 'rollup.json');
  writeFileSync(rollupPath, JSON.stringify(all, null, 2));
  console.log('\n=== rollup ===');
  console.log(JSON.stringify(all, null, 2));
  console.log(`\nWrote ${rollupPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
