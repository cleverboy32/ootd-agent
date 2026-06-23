import { Prisma } from '@prisma/client';
import prismadb from '@/server/db';
import {
  buildImageStates,
  buildPersistedMessageContent,
  extractStylistCache,
  StylistCacheNode,
  WardrobeCandidatesNode,
} from '@/server/utils/messageContent';

export async function getPreviousStylistCache(
  conversationId: string,
  excludeMessageId?: string
): Promise<StylistCacheNode | null> {
  const messages = await prismadb.message.findMany({
    where: { conversationId, role: 'assistant' },
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: { id: true, content: true },
  });

  for (const msg of messages) {
    if (excludeMessageId && msg.id === excludeMessageId) continue;
    const cache = extractStylistCache(msg.content);
    if (cache) return cache;
  }
  return null;
}

export async function getProfileLocation(clientId?: string): Promise<string | undefined> {
  if (!clientId) return undefined;

  try {
    const profile = await prismadb.clientProfile.findUnique({
      where: { id: clientId },
      select: { profileData: true },
    });
    if (!profile?.profileData || typeof profile.profileData !== 'object') return undefined;

    const location = (profile.profileData as Record<string, unknown>).location;
    return typeof location === 'string' && location.trim() ? location.trim() : undefined;
  } catch (error) {
    console.warn('[ORCHESTRATOR] Failed to read profile location:', error);
    return undefined;
  }
}

export async function persistMessageContent(
  messageId: string,
  options: {
    text: string;
    stylistCache: StylistCacheNode | null;
    imageMap: Map<string, string>;
    failedImageIds: Set<string>;
    outfitIds: string[];
    status: 'completed' | 'failed' | 'generating';
    wardrobeCandidates?: WardrobeCandidatesNode | null;
  }
): Promise<void> {
  const imageStates = buildImageStates(options.outfitIds, options.imageMap, options.failedImageIds);
  const content = buildPersistedMessageContent({
    text: options.text,
    stylistCache: options.stylistCache,
    imageStates,
    wardrobeCandidates: options.wardrobeCandidates,
  });

  await prismadb.message.update({
    where: { id: messageId },
    data: {
      content: content as Prisma.InputJsonValue,
      status: options.status,
    },
  });
}
