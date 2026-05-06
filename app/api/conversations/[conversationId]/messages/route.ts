import { NextRequest, NextResponse } from 'next/server';
import prismadb from '@/lib/prisma';

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

  if (!conversationId) {
    return NextResponse.json({ error: 'Conversation ID is required' }, { status: 400 });
  }

  try {
    const messages = await prismadb.message.findMany({
      where: {
        conversationId: conversationId,
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
 * @param req The Next.js request object containing the message data.
 * @param params The route parameters, containing `conversationId`.
 * @returns A JSON response with the newly created message or an error.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
    const { conversationId } = await params;
  
    if (!conversationId) {
      return NextResponse.json({ error: 'Conversation ID is required' }, { status: 400 });
    }

    try {
        const body = await req.json();
        // role: "user" | "ai"
        // content: Json (as defined in schema.prisma)
        const { role, content } = body;

        if (!role || !content) {
            return NextResponse.json({ error: 'Role and content are required' }, { status: 400 });
        }

        // Create the new message and associate it with the conversation
        const newMessage = await prismadb.message.create({
            data: {
                conversationId: conversationId,
                role: role,
                content: content,
                // The `timestamp` field in your schema doesn't have a default,
                // let's add the current time here.
                timestamp: new Date(), 
            }
        });

        // By creating a related message, the parent conversation's `updatedAt`
        // field will be automatically updated by Prisma.
        // This is useful for sorting conversations by recent activity.

        return NextResponse.json(newMessage, { status: 201 });

    } catch (error) {
        console.error('[MESSAGES_POST]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}