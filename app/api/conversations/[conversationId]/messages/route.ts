import { NextRequest, NextResponse } from 'next/server';
import prismadb from '@/lib/prisma';
import { extractUserInfoFromText } from '@/app/services/analysis-service'; // 1. Import our new service

type RouteParams = {
  params: Promise<{
    conversationId: string;
  }>;
};

/**
 * A helper function to trigger the analysis and update the client profile.
 * It runs in the background ("fire and forget").
 * @param text The user's message content.
 * @param conversationId The ID of the current conversation.
 */
async function triggerAnalysis(text: string, conversationId: string) {
  try {
    // Find the conversation to get the clientId
    const conversation = await prismadb.conversation.findUnique({
      where: { id: conversationId },
      select: { clientId: true },
    });

    if (!conversation) return;
    const { clientId } = conversation;

    // Call our AI service to extract information
    const extractedData = await extractUserInfoFromText(text);

    // If the service returned data, update the client's profile
    if (extractedData) {
      // We need the full URL for server-side fetch
      const updateUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/clients/${clientId}`;
      
      await fetch(updateUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extractedData),
      });
    }
  } catch (error) {
    console.error(`[ANALYSIS_TRIGGER] Failed for conversation ${conversationId}:`, error);
  }
}

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
 * And triggers a background task to analyze user messages for profile information.
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
    const { role, content } = body;

    if (!role || !content) {
      return NextResponse.json({ error: 'Role and content are required' }, { status: 400 });
    }

    console.log('接收到的消息', JSON.stringify(content))

    // 2. Create the new message and associate it with the conversation
    const newMessage = await prismadb.message.create({
      data: {
        conversationId: conversationId,
        role: role,
        content: content,
        timestamp: new Date(),
      },
    });

    // 3. If the message is from the user, trigger the analysis in the background
    const textToAnalyze = content.map((item) => item.text).join(';')
    if (role === 'user' && typeof content === 'string') {
      // We don't await this, so it doesn't block the response.
      triggerAnalysis(textToAnalyze, conversationId);
    }

    return NextResponse.json(newMessage, { status: 201 });

  } catch (error) {
    console.error('[MESSAGES_POST]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}