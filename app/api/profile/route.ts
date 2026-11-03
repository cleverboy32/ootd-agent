import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prismadb from '@/server/db';

/**
 * 当前登录用户档案（ClientProfile）。
 * 身份只认 proxy 注入的 session：x-user-id + x-client-id（= user.clientProfileId）。
 */

function mergeProfileData(
  currentProfile: Prisma.JsonObject,
  newData: Prisma.JsonObject
): Prisma.JsonObject {
  const merged = { ...currentProfile };
  for (const key in newData) {
    if (!Object.prototype.hasOwnProperty.call(newData, key)) continue;
    const newValue = newData[key];
    const oldValue = merged[key];
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      merged[key] = [...new Set([...oldValue, ...newValue])];
    } else {
      merged[key] = newValue;
    }
  }
  return merged;
}

function requireProfileIdentity(req: NextRequest):
  | { clientId: string; userId: string }
  | NextResponse {
  const clientId = req.headers.get('x-client-id')?.trim();
  const userId = req.headers.get('x-user-id')?.trim();
  if (!clientId || !userId) {
    return NextResponse.json(
      { error: '请先登录', code: 'UNAUTHENTICATED' },
      { status: 401 }
    );
  }
  return { clientId, userId };
}

export async function GET(req: NextRequest) {
  const identity = requireProfileIdentity(req);
  if (identity instanceof NextResponse) return identity;
  const { clientId } = identity;

  try {
    const clientProfile = await prismadb.clientProfile.findUnique({
      where: { id: clientId },
    });

    const cacheHeaders = {
      'Cache-Control': 'private, max-age=60',
    };

    if (!clientProfile) {
      return NextResponse.json(
        { id: clientId, profileData: {} },
        { headers: cacheHeaders }
      );
    }

    return NextResponse.json(clientProfile, { headers: cacheHeaders });
  } catch (error) {
    console.error(`[PROFILE_GET] clientId=${clientId}`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const identity = requireProfileIdentity(req);
  if (identity instanceof NextResponse) return identity;
  const { clientId } = identity;

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'A valid JSON object is required' }, { status: 400 });
    }

    const client = await prismadb.clientProfile.upsert({
      where: { id: clientId },
      update: {},
      create: {
        id: clientId,
        profileData: {},
      },
    });

    const currentProfile = (client.profileData as Prisma.JsonObject) || {};
    const updatedProfileData = mergeProfileData(currentProfile, body as Prisma.JsonObject);

    const updatedClient = await prismadb.clientProfile.update({
      where: { id: clientId },
      data: {
        profileData: updatedProfileData,
      },
    });

    return NextResponse.json(updatedClient);
  } catch (error) {
    console.error(`[PROFILE_PATCH] clientId=${clientId}`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
