import { NextRequest, NextResponse } from 'next/server';
import prismadb from '@/server/db';
import { MessageContentPart } from '@/lib/types';

type RouteParams = {
  params: Promise<{
    conversationId: string;
  }>;
};

/**
 * Handles GET requests to fetch all messages for a specific conversation.
 * @param req The Next.js request object.
 * @param params The route parameters, containing `conversationId`.
 * @returns A JSON response with the list of messages or an error.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { conversationId } = await params;
  const clientId = req.headers.get('x-client-id');

  if (!conversationId || !clientId) {
    return NextResponse.json(
      { error: 'Conversation ID and Client ID are required' },
      { status: 400 }
    );
  }

  try {
    const messages = await prismadb.message.findMany({
      where: {
        conversationId,
        conversation: { clientId },
      },
      orderBy: {
        createdAt: 'asc', // Order messages chronologically
      },
    });
    return NextResponse.json(messages);
  } catch (error) {
    console.error('[MESSAGES_GET]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Handles POST requests to add a new message to a conversation.
 * This also implicitly updates the conversation's `updatedAt` timestamp.
 * And triggers a background task to analyze user messages for profile information.
 * @param req The Next.js request object containing the message data.
 * @param params The route parameters, containing `conversationId`.
 * @returns A JSON response with the newly created message or an error.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { conversationId } = await params;
  const clientId = req.headers.get('x-client-id');

  if (!conversationId || !clientId) {
    return NextResponse.json(
      { error: 'Conversation ID and Client ID are required' },
      { status: 400 }
    );
  }

  try {
    const ownedConversation = await prismadb.conversation.findFirst({
      where: { id: conversationId, clientId },
      select: { id: true },
    });
    if (!ownedConversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const body: { role: 'user' | 'ai', content: MessageContentPart[] } = await req.json();
    const { role, content } = body;

    if (!role || !content) {
      return NextResponse.json({ error: 'Role and content are required' }, { status: 400 });
    }

    console.log('接收到的消息', JSON.stringify(content))

    const newMessage = await prismadb.message.create({
      data: {
        conversationId: conversationId,
        role: role,
        content: content,
        timestamp: new Date(),
      },
    });

    return NextResponse.json(newMessage, { status: 201 });

  } catch (error) {
    console.error('[MESSAGES_POST]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
