import { NextRequest, NextResponse } from 'next/server';
import {
  analyzeVisualProfileFromImage,
  portraitRejectionMessage,
} from '@/server/agents/visual/profile';
import { logVisualProfileAudit } from '@/server/logging/visualProfile';
import {
  isClientOwnedUploadUrl,
  mergeVisualAnalysisIntoProfile,
} from '@/server/utils/profileMetadata';
import { updateUserProfileData } from '@/server/utils/profileWrite';
import { profileFromDbRecord } from '@/server/agents/user-profile';
import { normalizeVisualFeaturesForZh } from '@/lib/hairColorDisplay';

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: '请先登录', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const startMs = Date.now();

  try {
    const body = await req.json();
    const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : '';

    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 });
    }

    if (!isClientOwnedUploadUrl(imageUrl, userId)) {
      return NextResponse.json({ error: 'Invalid image URL' }, { status: 403 });
    }

    const visualResult = await analyzeVisualProfileFromImage(imageUrl);

    if (!visualResult.is_valid_portrait) {
      void logVisualProfileAudit({
        timestamp: new Date().toISOString(),
        clientId: userId,
        imageUrl,
        durationMs: Date.now() - startMs,
        success: false,
        error: 'not_a_valid_portrait',
      });
      return NextResponse.json(
        { error: portraitRejectionMessage(visualResult.portrait_issue) },
        { status: 422 }
      );
    }

    const normalizedVisual = {
      ...visualResult,
      visual_features: normalizeVisualFeaturesForZh(visualResult.visual_features),
    };
    const written = await updateUserProfileData(userId, (existingProfile) =>
      mergeVisualAnalysisIntoProfile(existingProfile, normalizedVisual, imageUrl)
    );
    if (written.status === 'missing') {
      return NextResponse.json({ error: '请先登录', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const mergedProfile = written.profileData;

    void logVisualProfileAudit({
      timestamp: new Date().toISOString(),
      clientId: userId,
      imageUrl,
      durationMs: Date.now() - startMs,
      success: true,
      result: {
        skin_tone: visualResult.skin_tone,
        body_shape: visualResult.body_shape,
        gender: visualResult.gender,
        suited_style: visualResult.suited_style,
        hair_color: visualResult.visual_features.hair_color,
      },
    });

    const profileData = profileFromDbRecord(mergedProfile);

    return NextResponse.json({
      profileData: {
        ...profileData,
        visual_profile_verified: true,
        full_body_verified: true,
        selfie_image_url: imageUrl,
        selfie_analyzed_at: mergedProfile.selfie_analyzed_at,
        location: typeof mergedProfile.location === 'string' ? mergedProfile.location : undefined,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[VISUAL_PROFILE_API] ClientID: ${userId}`, error);

    void logVisualProfileAudit({
      timestamp: new Date().toISOString(),
      clientId: userId,
      imageUrl: '',
      durationMs: Date.now() - startMs,
      success: false,
      error: message,
    });

    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
