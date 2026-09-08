import { Prisma } from '@prisma/client';
import prismadb from '@/server/db';
import {
  buildImageStates,
  buildPersistedMessageContent,
  extractStylistCache,
  StylistCacheNode,
  WardrobeCandidatesNode,
} from '@/server/utils/messageContent';
import { mergeLocationIntoProfileData } from '@/server/utils/profileMetadata';

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

/** 在近期 assistant cache 中找回待购锚点 URL（跳过已丢失锚点的 revision cache） */
export async function findPreviousAnchorImageUrl(
  conversationId: string,
  excludeMessageId?: string
): Promise<string | undefined> {
  const messages = await prismadb.message.findMany({
    where: { conversationId, role: 'assistant' },
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: { id: true, content: true },
  });

  for (const msg of messages) {
    if (excludeMessageId && msg.id === excludeMessageId) continue;
    const cache = extractStylistCache(msg.content);
    const url = cache?.stylist_result.anchor_image_url?.trim();
    if (url) return url;
  }
  return undefined;
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

/** Gate 抽出有效城市后写入 profileData.location，供后续轮次天气门闸复用 */
export async function persistProfileLocation(
  clientId: string | undefined,
  city: string | undefined
): Promise<void> {
  if (!clientId || !city?.trim()) return;

  try {
    const existing = await prismadb.clientProfile.findUnique({
      where: { id: clientId },
      select: { profileData: true },
    });
    const current =
      existing?.profileData && typeof existing.profileData === 'object'
        ? (existing.profileData as Record<string, unknown>)
        : {};
    const { next, changed } = mergeLocationIntoProfileData(current, city);
    if (!changed) return;

    await prismadb.clientProfile.upsert({
      where: { id: clientId },
      update: { profileData: next as Prisma.InputJsonValue },
      create: { id: clientId, profileData: next as Prisma.InputJsonValue },
    });
    console.log(`[ORCHESTRATOR] profile location saved: ${city.trim()}`);
  } catch (error) {
    console.warn('[ORCHESTRATOR] Failed to persist profile location:', error);
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
