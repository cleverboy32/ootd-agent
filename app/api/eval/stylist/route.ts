import { NextRequest } from 'next/server';
import type { ClothingItem } from '@prisma/client';
import { callStylistAgent } from '@/server/agents/stylist';
import type { EvalWardrobeItem } from '@/server/agents/stylist/evalWardrobe';
import { normalizeStylistSkillNames } from '@/server/agents/stylist/skillSelection';
import { selectStylistSkills } from '@/server/agents/stylist/selectSkills';
import type { GatekeeperIntent } from '@/server/agents/intent';
import type { UserProfileResult } from '@/server/agents/user-profile/schema';
import { buildImagePrompt, generateOutfitImage } from '@/server/agents/visual/imageGen';
import { uploadImageToCOS } from '@/server/services/cos';

export const runtime = 'nodejs';
export const maxDuration = 300;

type EvalStylistBody = {
  user_message?: string;
  intent?: Partial<GatekeeperIntent>;
  profile?: Partial<UserProfileResult>;
  wardrobeItems?: EvalWardrobeItem[];
  skillOverride?: string[];
  with_images?: boolean;
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
    weatherConditions: partial?.weatherConditions,
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
    // 厚薄只认 weather 可解析 ℃；dressing_climate 恒为空（与 Gatekeeper finalize 对齐）
    dressing_climate: partial?.dressing_climate ?? '',
  };
}

function evalEnabled(): boolean {
  return process.env.EVAL_API_ENABLED === 'true' || process.env.EVAL_API_ENABLED === '1';
}

export async function POST(req: NextRequest) {
  if (!evalEnabled()) {
    return Response.json(
      { error: 'Eval API disabled. Set EVAL_API_ENABLED=true' },
      { status: 403 }
    );
  }

  let body: EvalStylistBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const wardrobeItems = Array.isArray(body.wardrobeItems) ? body.wardrobeItems : [];
  if (wardrobeItems.length === 0) {
    return Response.json({ error: 'wardrobeItems is required (mock wardrobe)' }, { status: 400 });
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

  const ragCache = new Map<string, ClothingItem>();
  const startedAt = Date.now();

  try {
    const skillNames =
      body.skillOverride && body.skillOverride.length > 0
        ? normalizeStylistSkillNames(body.skillOverride)
        : await selectStylistSkills(intent, userMessage, profile, {});

    const stylistResult = await callStylistAgent(
      [],
      intent,
      profile,
      [{ text: userMessage }],
      undefined,
      ragCache,
      undefined,
      {
        messageId: `eval-${Date.now()}`,
        evalWardrobeItems: wardrobeItems,
        skillOverride: skillNames,
      }
    );

    const latencyMs = Date.now() - startedAt;
    const images: Array<{ outfit_id: string; image_url: string }> = [];

    if (body.with_images) {
      for (const outfit of stylistResult.outfits) {
        try {
          const wardrobeUrls = outfit.selected_items
            .map((item) => ragCache.get(item.id)?.imageUrl)
            .filter((url): url is string => Boolean(url && url.trim()));
          const imgPrompt = buildImagePrompt(outfit, ragCache);
          const { data, mimeType } = await generateOutfitImage(
            outfit,
            wardrobeUrls,
            stylistResult.anchor_item_image_data,
            imgPrompt,
            'initial',
            undefined,
            ragCache,
            profile,
            stylistResult.anchor_image_url
          );
          const url = await uploadImageToCOS(
            data,
            mimeType,
            `eval-outfits/${Date.now()}-${outfit.id}.png`
          );
          images.push({ outfit_id: outfit.id, image_url: url });
        } catch (imgErr) {
          console.error(`[EVAL_STYLIST] image failed for ${outfit.id}:`, imgErr);
        }
      }
    }

    return Response.json({
      ok: true,
      latency_ms: latencyMs,
      skill_names: skillNames,
      intent,
      profile,
      user_message: userMessage,
      stylist_result: stylistResult,
      images,
    });
  } catch (error) {
    console.error('[EVAL_STYLIST] failed:', error);
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
