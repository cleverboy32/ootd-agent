import { NextRequest, NextResponse } from 'next/server';
import prismadb from '@/server/db';

// Define the type for the route parameters, accommodating Next.js 15's promise-based params
type RouteParams = {
  params: Promise<{ conversationId: string }>;
};

/**
 * Handles DELETE requests to remove a specific conversation.
 * @param req The Next.js request object (not used in this function).
 * @param params The route parameters, containing the `conversationId`.
 * @returns A JSON response indicating success or failure.
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { conversationId } = await params;

  if (!conversationId) {
    return NextResponse.json({ error: 'Conversation ID is required' }, { status: 400 });
  }

  try {
    // Attempt to delete the conversation by its ID.
    // Thanks to `onDelete: Cascade` in the schema, all related messages
    // will be automatically deleted as well.
    await prismadb.conversation.delete({
      where: {
        id: conversationId,
      },
    });

    // Return a success response with no body content.
    return new NextResponse(null, { status: 204 });

  } catch (error) {
    // It's good practice to check for specific Prisma errors,
    // like if the record to delete was not found.
    if (error instanceof Error && error.name === 'P2025') { // Prisma's record not found error code
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    console.error('[CONVERSATION_DELETE]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}