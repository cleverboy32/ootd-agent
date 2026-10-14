import { NextRequest, NextResponse } from 'next/server';
import prismadb from '@/server/db';
import { MessageContentPart } from '@/lib/types';
import { buildMessagePage, parseMessagePageLimit } from '@/server/utils/messagePage';

type RouteParams = {
  params: Promise<{
    conversationId: string;
  }>;
};

/**
 * Handles GET requests to fetch one page of messages for a specific conversation.
 * Query: `limit` (default 20, max 50), `before` (message id cursor; omitted for the latest page).
 * @param req The Next.js request object.
 * @param params The route parameters, containing `conversationId`.
 * @returns `{ messages, nextCursor }` with messages in chronological order, or an error.
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

  const { searchParams } = req.nextUrl;
  const limit = parseMessagePageLimit(searchParams.get('limit'));
  const before = searchParams.get('before');

  try {
    const rowsDesc = await prismadb.message.findMany({
      where: {
        conversationId,
        conversation: { clientId },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(before && { cursor: { id: before }, skip: 1 }),
    });
    return NextResponse.json(buildMessagePage(rowsDesc, limit));
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

    const body = (await req.json()) as { role?: unknown; content?: unknown };
    const { role, content } = body;

    // AI 消息只由服务端生成链路写入（graph/nodes.ts 占位 + helpers.ts 更新），客户端只能写用户消息
    if (role !== 'user' || !Array.isArray(content) || content.length === 0) {
      return NextResponse.json(
        { error: 'Only user messages with non-empty content can be posted' },
        { status: 400 }
      );
    }

    console.log('接收到的消息', JSON.stringify(content))

    const newMessage = await prismadb.message.create({
      data: {
        conversationId: conversationId,
        role: 'user',
        content: content as MessageContentPart[],
        timestamp: new Date(),
      },
    });

    return NextResponse.json(newMessage, { status: 201 });

  } catch (error) {
    console.error('[MESSAGES_POST]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
