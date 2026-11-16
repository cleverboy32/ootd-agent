import { NextRequest } from 'next/server';
import type { ClothingItem } from '@prisma/client';
import { planOutfitsAndQueries } from '@/server/agents/stylist/agent';
import { performRagSearch } from '@/server/agents/rag/search';
import { normalizeStylistSkillNames } from '@/server/agents/stylist/skillSelection';
import { selectStylistSkills } from '@/server/agents/stylist/selectSkills';
import type { GatekeeperIntent } from '@/server/agents/intent';
import {
  getResolvedAnchorFromIntent,
  isPurchasePairingIntent,
  isWardrobePairingIntent,
  listPurchaseAnchors,
  type AnchorItemInfo,
} from '@/server/agents/intent';
import type { UserProfileResult } from '@/server/agents/user-profile/schema';

export const runtime = 'nodejs';
export const maxDuration = 300;

const DEFAULT_EVAL_USER_ID = 'cmv3mqdxe0001bqs8bc5nsmmx';

type EvalRetrieveBody = {
  user_message?: string;
  intent?: Partial<GatekeeperIntent>;
  profile?: Partial<UserProfileResult>;
  skillOverride?: string[];
  userId?: string;
};

const DEFAULT_PROFILE: UserProfileResult = {
  name: '评测用户',
  height: '165cm',
  weight: '50kg',
  preferences: ['日常休闲'],
  skin_tone: '',
  body_shape: '',
  personal_style: '日常休闲',
  gender: '女',
  visual_features: { hair_color: '', detected_features: '' },
};

function buildIntent(partial: Partial<GatekeeperIntent> | undefined): GatekeeperIntent {
  return {
    weather: partial?.weather ?? '',
    city: partial?.city ?? '',
    city_role: partial?.city_role ?? '',
    occasion: partial?.occasion ?? '日常出行',
    style_preference: partial?.style_preference ?? '日常休闲',
    special_requests: partial?.special_requests ?? '',
    request_type: partial?.request_type ?? 'wardrobe_outfit',
    anchor_item_summary: partial?.anchor_item_summary ?? '',
    wardrobe_search_query: partial?.wardrobe_search_query,
    anchor_slot: partial?.anchor_slot ?? '',
    anchor_image_url: partial?.anchor_image_url,
    session_item_id: partial?.session_item_id,
    purchase_items: partial?.purchase_items,
    purchase_vision_pending: partial?.purchase_vision_pending,
    selected_outfit_id: partial?.selected_outfit_id,
    anchor_wardrobe_id: partial?.anchor_wardrobe_id,
    dressing_climate: partial?.dressing_climate ?? '',
  };
}

function evalEnabled(): boolean {
  return process.env.EVAL_API_ENABLED === 'true' || process.env.EVAL_API_ENABLED === '1';
}

function resolveEvalUserId(bodyUserId?: string): string {
  const fromBody = (bodyUserId ?? '').trim();
  if (fromBody) return fromBody;
  const fromEnv = (process.env.EVAL_WARDROBE_USER_ID ?? '').trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_EVAL_USER_ID;
}

export async function POST(req: NextRequest) {
  if (!evalEnabled()) {
    return Response.json(
      { error: 'Eval API disabled. Set EVAL_API_ENABLED=true' },
      { status: 403 }
    );
  }

  let body: EvalRetrieveBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const userMessage = (body.user_message ?? '').trim() || '帮我搭一套今天的日常穿搭';
  const intent = buildIntent(body.intent);
  const profile: UserProfileResult = { ...DEFAULT_PROFILE, ...body.profile };
  if (body.profile?.preferences) {
    profile.preferences = body.profile.preferences;
  }
  if (body.profile?.visual_features) {
    profile.visual_features = {
      ...DEFAULT_PROFILE.visual_features,
      ...body.profile.visual_features,
    };
  }

  const userId = resolveEvalUserId(body.userId);
  const ragCache = new Map<string, ClothingItem>();
  const startedAt = Date.now();

  try {
    if (isPurchasePairingIntent(intent) && !getResolvedAnchorFromIntent(intent)) {
      throw new Error('PurchasePairingMissingAnchor: intent 缺少有效锚定单品');
    }
    if (isWardrobePairingIntent(intent) && !intent.anchor_wardrobe_id?.trim()) {
      throw new Error('WardrobePairingMissingAnchor: intent 缺少 anchor_wardrobe_id');
    }

    const skillNames =
      body.skillOverride && body.skillOverride.length > 0
        ? normalizeStylistSkillNames(body.skillOverride)
        : await selectStylistSkills(intent, userMessage, profile, {});

    const resolvedAnchor = getResolvedAnchorFromIntent(intent);
    const anchorItem: AnchorItemInfo | null = resolvedAnchor
      ? {
          name: resolvedAnchor.name,
          summary: resolvedAnchor.summary,
          slot: resolvedAnchor.slot,
          imageData: resolvedAnchor.imageData,
          imageUrl: resolvedAnchor.imageUrl,
        }
      : null;
    const purchaseAnchors = isPurchasePairingIntent(intent) ? listPurchaseAnchors(intent) : [];

    const planned = await planOutfitsAndQueries(
      [],
      intent,
      profile,
      userMessage,
      anchorItem,
      undefined,
      purchaseAnchors,
      skillNames,
      { messageId: `eval-retrieve-${Date.now()}` }
    );

    const searchResults = await performRagSearch(planned.queries, userId, ragCache, {
      source: 'eval-retrieve',
      userMessage,
      intent,
      anchorItem: anchorItem ?? undefined,
      skillNames,
    });

    const latencyMs = Date.now() - startedAt;

    return Response.json({
      ok: true,
      latency_ms: latencyMs,
      skill_names: skillNames,
      user_id: userId,
      intent,
      profile,
      user_message: userMessage,
      plan: planned.plan,
      queries: planned.queries,
      slots: searchResults.slotSnapshots,
      item_count: searchResults.items.length,
    });
  } catch (error) {
    console.error('[EVAL_RETRIEVE] failed:', error);
    return Response.json(
      {
        ok: false,
        latency_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
