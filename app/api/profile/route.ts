import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prismadb from '@/server/db';
import { updateUserProfileData } from '@/server/utils/profileWrite';

/**
 * 当前登录用户档案。身份只认 proxy 注入的 x-user-id。
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

function requireUserId(req: NextRequest): string | NextResponse {
  const userId = req.headers.get('x-user-id')?.trim();
  if (!userId) {
    return NextResponse.json(
      { error: '请先登录', code: 'UNAUTHENTICATED' },
      { status: 401 }
    );
  }
  return userId;
}

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (userId instanceof NextResponse) return userId;

  try {
    const user = await prismadb.user.findUnique({
      where: { id: userId },
      select: { id: true, profileData: true },
    });

    const cacheHeaders = {
      'Cache-Control': 'private, max-age=60',
    };

    if (!user) {
      return NextResponse.json(
        { id: userId, profileData: {} },
        { headers: cacheHeaders }
      );
    }

    return NextResponse.json(
      { id: user.id, profileData: user.profileData },
      { headers: cacheHeaders }
    );
  } catch (error) {
    console.error(`[PROFILE_GET] userId=${userId}`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const userId = requireUserId(req);
  if (userId instanceof NextResponse) return userId;

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'A valid JSON object is required' }, { status: 400 });
    }

    const written = await updateUserProfileData(userId, (current) =>
      mergeProfileData(current as Prisma.JsonObject, body as Prisma.JsonObject)
    );
    if (written.status === 'missing') {
      return NextResponse.json({ error: '请先登录', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    return NextResponse.json({ id: userId, profileData: written.profileData });
  } catch (error) {
    console.error(`[PROFILE_PATCH] userId=${userId}`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
