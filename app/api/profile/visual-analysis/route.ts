import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prismadb from '@/server/db';
import { analyzeVisualProfileFromImage } from '@/server/services/visualProfileAgent';
import { logVisualProfileAudit } from '@/server/services/visualProfileAuditLogger';
import {
  isClientOwnedUploadUrl,
  mergeVisualAnalysisIntoProfile,
} from '@/server/utils/profileMetadata';
import { profileFromDbRecord } from '@/app/api/generate-with-image/handlers/userProfileAgent';
import { normalizeVisualFeaturesForZh } from '@/lib/hairColorDisplay';

export async function POST(req: NextRequest) {
  const clientId = req.headers.get('X-Client-ID');
  if (!clientId) {
    return NextResponse.json({ error: 'X-Client-ID header is required' }, { status: 400 });
  }

  const startMs = Date.now();

  try {
    const body = await req.json();
    const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : '';

    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 });
    }

    if (!isClientOwnedUploadUrl(imageUrl, clientId)) {
      return NextResponse.json({ error: 'Invalid image URL' }, { status: 403 });
    }

    const visualResult = await analyzeVisualProfileFromImage(imageUrl);

    if (!visualResult.is_valid_portrait) {
      void logVisualProfileAudit({
        timestamp: new Date().toISOString(),
        clientId,
        imageUrl,
        durationMs: Date.now() - startMs,
        success: false,
        error: 'not_a_valid_portrait',
      });
      return NextResponse.json(
        { error: '请上传清晰的正面人像照片' },
        { status: 422 }
      );
    }

    const client = await prismadb.clientProfile.upsert({
      where: { id: clientId },
      update: {},
      create: { id: clientId, profileData: {} },
    });

    const existingProfile = (client.profileData as Record<string, unknown>) || {};
    const normalizedVisual = {
      ...visualResult,
      visual_features: normalizeVisualFeaturesForZh(visualResult.visual_features),
    };
    const mergedProfile = mergeVisualAnalysisIntoProfile(existingProfile, normalizedVisual, imageUrl);

    const updatedClient = await prismadb.clientProfile.update({
      where: { id: clientId },
      data: { profileData: mergedProfile as Prisma.InputJsonValue },
    });

    void logVisualProfileAudit({
      timestamp: new Date().toISOString(),
      clientId,
      imageUrl,
      durationMs: Date.now() - startMs,
      success: true,
      result: {
        skin_tone: visualResult.skin_tone,
        body_shape: visualResult.body_shape,
        hair_color: visualResult.visual_features.hair_color,
      },
    });

    const profileData = profileFromDbRecord(
      (updatedClient.profileData as Record<string, unknown>) || {}
    );

    return NextResponse.json({
      profileData: {
        ...profileData,
        visual_profile_verified: true,
        selfie_image_url: imageUrl,
        selfie_analyzed_at: mergedProfile.selfie_analyzed_at,
        location: typeof mergedProfile.location === 'string' ? mergedProfile.location : undefined,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[VISUAL_PROFILE_API] ClientID: ${clientId}`, error);

    void logVisualProfileAudit({
      timestamp: new Date().toISOString(),
      clientId,
      imageUrl: '',
      durationMs: Date.now() - startMs,
      success: false,
      error: message,
    });

    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
