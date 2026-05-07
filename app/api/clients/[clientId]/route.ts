import { NextRequest, NextResponse } from 'next/server';
import prismadb from '@/lib/prisma';
import { Prisma } from '@prisma/client';

type RouteParams = {
  params: Promise<{ clientId: string }>;
};

/**
 * Handles PATCH requests to update a client's profile data.
 * It merges the new data from the request body with the existing data.
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

    // First, ensure the client profile exists using an upsert operation.
    const client = await prismadb.clientProfile.upsert({
      where: { id: clientId },
      update: {}, // We don't update here, we merge below.
      create: {
        id: clientId,
        profileData: {}, // Initialize with an empty JSON object.
      },
    });

    // Fetch the current profile data to perform a merge.
    const currentProfile = (client.profileData as Prisma.JsonObject) || {};

    // Merge the existing data with the new data from the request body.
    const updatedProfileData = { ...currentProfile, ...body };

    // Save the merged data back to the database.
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

        // If no profile exists, return a default empty profile.
        // This can simplify frontend logic, as it won't have to handle null.
        if (!clientProfile) {
            return NextResponse.json({ id: clientId, profileData: {} });
        }

        return NextResponse.json(clientProfile);
    } catch (error) {
        console.error(`[CLIENT_PROFILE_GET] ClientID: ${clientId}`, error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}