import { NextRequest, NextResponse } from 'next/server';
import prismadb from '@/lib/prisma';

/**
 * Handles GET requests to fetch conversations for a specific client.
 * Expects a `clientId` as a URL search parameter.
 * @param req The Next.js request object.
 * @returns A JSON response with the list of conversations or an error.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');

  if (!clientId) {
    return NextResponse.json({ error: 'Client ID is required' }, { status: 400 });
  }

  try {
    const conversations = await prismadb.conversation.findMany({
      where: {
        clientId: clientId,
      },
      orderBy: {
        updatedAt: 'desc', // Show most recently updated conversations first
      },
    });
    return NextResponse.json(conversations);
  } catch (error) {
    console.error('[CONVERSATIONS_GET]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Handles POST requests to create a new conversation.
 * Expects `clientId` and `title` in the JSON request body.
 * @param req The Next.js request object.
 * @returns A JSON response with the newly created conversation or an error.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, clientId } = body;

    if (!clientId) {
      return NextResponse.json({ error: 'Client ID is required' }, { status: 400 });
    }
    
    if (!title) {
        return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const newConversation = await prismadb.conversation.create({
      data: {
        title: title,
        clientId: clientId,
      },
    });

    return NextResponse.json(newConversation, { status: 201 });
  } catch (error) {
    console.error('[CONVERSATIONS_POST]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}