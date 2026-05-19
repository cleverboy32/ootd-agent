import { NextRequest, NextResponse } from 'next/server';
import prismadb from '@/server/db';
import { Prisma } from '@prisma/client';

type RouteParams = {
  params: Promise<{ clientId: string }>;
};

// --- [新增] --- 智能合并辅助函数
/**
 * Intelligently merges new profile data into the current profile.
 * - For arrays, it concatenates and removes duplicates.
 * - For other types, it overwrites.
 * @param currentProfile The existing profile data from the database.
 * @param newData The newly extracted data from the AI.
 * @returns The new, merged profile data object.
 */
function mergeProfileData(currentProfile: Prisma.JsonObject, newData: Prisma.JsonObject): Prisma.JsonObject {
  const merged = { ...currentProfile };

  for (const key in newData) {
    if (Object.prototype.hasOwnProperty.call(newData, key)) {
      const newValue = newData[key];
      const oldValue = merged[key];

      // 如果新旧值都是数组，则合并并去重
      if (Array.isArray(oldValue) && Array.isArray(newValue)) {
        merged[key] = [...new Set([...oldValue, ...newValue])];
      } else {
        // 否则，直接用新值覆盖
        merged[key] = newValue;
      }
    }
  }
  return merged;
}

/**
 * Handles PATCH requests to update a client's profile data.
 * It intelligently merges the new data with the existing data.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { clientId } = await params;

  if (!clientId) {
    return NextResponse.json({ error: 'Client ID is required' }, { status: 400 });
  }

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

    // --- [核心修改] --- 使用新的智能合并函数
    const updatedProfileData = mergeProfileData(currentProfile, body);

    const updatedClient = await prismadb.clientProfile.update({
      where: { id: clientId },
      data: {
        profileData: updatedProfileData,
      },
    });

    return NextResponse.json(updatedClient);

  } catch (error) {
    console.error(`[CLIENT_PROFILE_PATCH] ClientID: ${clientId}`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


/**
 * Handles GET requests to retrieve a client's profile data.
 * (此函数保持不变)
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
    const { clientId } = await params;

    if (!clientId) {
        return NextResponse.json({ error: 'Client ID is required' }, { status: 400 });
    }

    try {
        const clientProfile = await prismadb.clientProfile.findUnique({
            where: { id: clientId },
        });
        
        if (!clientProfile) {
            return NextResponse.json({ id: clientId, profileData: {} });
        }

        return NextResponse.json(clientProfile);
    } catch (error) {
        console.error(`[CLIENT_PROFILE_GET] ClientID: ${clientId}`, error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}