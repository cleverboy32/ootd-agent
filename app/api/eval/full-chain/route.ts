import { createHash } from 'node:crypto';
import type { Content, Part } from '@google/genai';
import type { ClothingItem } from '@prisma/client';
import { NextRequest } from 'next/server';
import { callGatekeeperAgent } from '@/server/agents/gatekeeper/agent';
import { callCopywriterAgentStream } from '@/server/agents/copywriter/agent';
import { callStylistTurn } from '@/server/agents/stylist';
import type { RagSlotSnapshot } from '@/server/agents/rag/search';
import { selectStylistSkills } from '@/server/agents/stylist/selectSkills';
import {
  ensureNoStyleBasicsSkills,
  ensureOutfitCompatibilitySkill,
  ensureStylistVisualSkill,
  ensureWeatherDressingSkill,
  normalizeStylistSkillNames,
} from '@/server/agents/stylist/skillSelection';
import { profileFromDbRecord } from '@/server/agents/user-profile/agent';
import type { UserProfileResult } from '@/server/agents/user-profile/schema';
import { buildImagePrompt, generateOutfitImage } from '@/server/agents/visual/imageGen';
import { getProfileLocation } from '@/app/api/generate-with-image/helpers';
import prismadb from '@/server/db';
import { uploadImageToCOS } from '@/server/services/cos';
import { parseTemperatureCelsius } from '@/server/utils/slotTempFilter';
import { readFullBodyImageUrl } from '@/server/utils/profileMetadata';

export const runtime = 'nodejs';
export const maxDuration = 300;

const DEFAULT_EVAL_USER_ID = 'cmv3mqdxe0001bqs8bc5nsmmx';

type FullChainBody = {
  user_id?: string;
  user_message?: string;
  with_images?: boolean;
};

function evalEnabled(): boolean {
  return process.env.EVAL_API_ENABLED === 'true' || process.env.EVAL_API_ENABLED === '1';
}

function hashSnapshot(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function POST(req: NextRequest) {
  if (!evalEnabled()) {
    return Response.json({ error: 'Eval API disabled. Set EVAL_API_ENABLED=true' }, { status: 403 });
  }

  let body: FullChainBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const allowedUserId = (process.env.EVAL_WARDROBE_USER_ID || DEFAULT_EVAL_USER_ID).trim();
  const userId = (body.user_id || allowedUserId).trim();
  if (userId !== allowedUserId) {
    return Response.json({ error: 'Full-chain evaluation is restricted to EVAL_WARDROBE_USER_ID' }, { status: 403 });
  }
  const userMessage = (body.user_message || '').trim();
  if (!userMessage) return Response.json({ error: 'user_message is required' }, { status: 400 });

  const startedAt = Date.now();
  try {
    const user = await prismadb.user.findUnique({
      where: { id: userId },
      select: { id: true, profileData: true },
    });
    if (!user) return Response.json({ error: 'Evaluation user not found' }, { status: 404 });

    const profileData = (user.profileData || {}) as Record<string, unknown>;
    const profile: UserProfileResult = profileFromDbRecord(profileData);
    const portraitImageUrl = readFullBodyImageUrl(profileData, userId);
    const wardrobe = await prismadb.clothingItem.findMany({
      where: { userId, status: 'completed' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        imageUrl: true,
        mainCategory: true,
        subCategory: true,
        season: true,
        material: true,
        tempMin: true,
        tempMax: true,
        description: true,
        colors: true,
        tags: true,
        searchDescription: true,
        occasions: true,
        formality: true,
        silhouette: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const wardrobeSnapshot = wardrobe.map((item) => ({ ...item }));
    const profileSnapshot = { ...profile };
    const history: Content[] = [];
    const currentInput: Part[] = [{ text: userMessage }];
    const messageId = `eval-full-chain-${Date.now()}`;

    const gatekeeper = await callGatekeeperAgent(
      history,
      currentInput,
      { userId, profileLocation: await getProfileLocation(userId) },
      { messageId }
    );
    if (!gatekeeper.is_complete) {
      return Response.json({
        ok: true,
        complete: false,
        latency_ms: Date.now() - startedAt,
        user_id: userId,
        user_message: userMessage,
        gatekeeper_result: gatekeeper,
        profile_snapshot: profileSnapshot,
        profile_hash: hashSnapshot(profileSnapshot),
        wardrobe_snapshot: wardrobeSnapshot,
        wardrobe_hash: hashSnapshot(wardrobeSnapshot),
        wardrobe_count: wardrobeSnapshot.length,
      });
    }

    const intent = gatekeeper.extracted_intent;
    const selectedSkills = await selectStylistSkills(intent, userMessage, profile, { messageId });
    const effectiveSkillNames = ensureNoStyleBasicsSkills(
      ensureOutfitCompatibilitySkill(
        ensureStylistVisualSkill(
          ensureWeatherDressingSkill(
            normalizeStylistSkillNames(selectedSkills),
            intent.weather || '',
            (weather) => parseTemperatureCelsius(weather) !== null
          )
        )
      )
    );
    const ragCache = new Map<string, ClothingItem>();
    let ragSlots: RagSlotSnapshot[] = [];
    const turn = await callStylistTurn(
      history,
      intent,
      profile,
      currentInput,
      userId,
      ragCache,
      undefined,
      {
        messageId,
        skillOverride: selectedSkills,
        onRagSnapshots: (snapshots) => { ragSlots = snapshots; },
      }
    );
    if (turn.type !== 'outfits') {
      return Response.json({
        ok: true,
        complete: false,
        latency_ms: Date.now() - startedAt,
        user_id: userId,
        user_message: userMessage,
        gatekeeper_result: gatekeeper,
        stylist_reply: turn.reply,
        profile_snapshot: profileSnapshot,
        profile_hash: hashSnapshot(profileSnapshot),
        wardrobe_snapshot: wardrobeSnapshot,
        wardrobe_hash: hashSnapshot(wardrobeSnapshot),
        wardrobe_count: wardrobeSnapshot.length,
      });
    }

    let copywriterText = '';
    const sink = {
      desiredSize: 1,
      enqueue() {},
    } as unknown as ReadableStreamDefaultController;
    await callCopywriterAgentStream(
      turn.result,
      profile.personal_style,
      sink,
      (text) => { copywriterText = text; },
      { messageId },
      turn.intent,
      false,
      userMessage
    );

    const images: Array<{ outfit_id: string; image_url: string; error?: string }> = [];
    if (body.with_images) {
      for (const outfit of turn.result.outfits) {
        try {
          const wardrobeUrls = outfit.selected_items
            .map((item) => ragCache.get(item.id)?.imageUrl)
            .filter((url): url is string => Boolean(url?.trim()));
          const prompt = buildImagePrompt(outfit, ragCache);
          const { data, mimeType } = await generateOutfitImage(
            outfit,
            wardrobeUrls,
            turn.result.anchor_item_image_data,
            prompt,
            'initial',
            messageId,
            ragCache,
            profile,
            turn.result.anchor_image_url,
            undefined,
            portraitImageUrl
          );
          const imageUrl = await uploadImageToCOS(
            data,
            mimeType,
            `eval-full-chain/${Date.now()}-${outfit.id}.png`
          );
          images.push({ outfit_id: outfit.id, image_url: imageUrl });
        } catch (error) {
          images.push({
            outfit_id: outfit.id,
            image_url: '',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return Response.json({
      ok: true,
      complete: true,
      latency_ms: Date.now() - startedAt,
      user_id: userId,
      user_message: userMessage,
      gatekeeper_result: gatekeeper,
      intent: turn.intent,
      profile: profileSnapshot,
      profile_snapshot: profileSnapshot,
      profile_hash: hashSnapshot(profileSnapshot),
      wardrobe_snapshot: wardrobeSnapshot,
      wardrobe_hash: hashSnapshot(wardrobeSnapshot),
      wardrobe_count: wardrobeSnapshot.length,
      selected_skill_names: selectedSkills,
      skill_names: effectiveSkillNames,
      stylist_result: turn.result,
      rag_slots: ragSlots,
      copywriter_text: copywriterText,
      images,
    });
  } catch (error) {
    console.error('[EVAL_FULL_CHAIN] failed:', error);
    return Response.json({
      ok: false,
      latency_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
