import { NextRequest, NextResponse } from 'next/server';
import prismadb from '@/server/db';
import type { MessageContentPart } from '@/lib/types';

/**
 * Handles GET requests to fetch conversations for a specific client.
 * Expects a `clientId` as a URL search parameter.
 * @param req The Next.js request object.
 * @returns A JSON response with the list of conversations or an error.
 */
export async function GET(req: NextRequest) {
  const clientId = req.headers.get('X-Client-ID');

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

interface CreateConversationBody {
  title?: unknown;
  firstMessage?: { role?: unknown; content?: unknown };
}

/**
 * Handles POST requests to create a new conversation.
 * Body: `title`, optional `firstMessage` ({ role: 'user', content: MessageContentPart[] })
 * persisted in the same write so a new chat costs one round trip instead of two.
 * @param req The Next.js request object.
 * @returns A JSON response with the newly created conversation or an error.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateConversationBody;
    const { title, firstMessage } = body;
    const clientId = req.headers.get('X-Client-ID');

    if (!clientId) {
      return NextResponse.json({ error: 'Client ID is required' }, { status: 400 });
    }

    if (typeof title !== 'string' || !title) {
        return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    if (
      firstMessage !== undefined &&
      (firstMessage.role !== 'user' ||
        !Array.isArray(firstMessage.content) ||
        firstMessage.content.length === 0)
    ) {
      return NextResponse.json(
        { error: 'firstMessage must be a user message with non-empty content' },
        { status: 400 }
      );
    }

    const newConversation = await prismadb.conversation.create({
      data: {
        title,
        clientId,
        ...(firstMessage && {
          messages: {
            create: {
              role: 'user',
              content: firstMessage.content as MessageContentPart[],
              timestamp: new Date(),
            },
          },
        }),
      },
    });

    return NextResponse.json(newConversation, { status: 201 });
  } catch (error) {
    console.error('[CONVERSATIONS_POST]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}