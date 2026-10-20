import { apiClient } from '@/lib/api-client';

export interface SavedOutfitItemSnapshot {
  wardrobeItemId?: string;
  name: string;
  layer: string;
  imageUrl?: string;
}

export interface SavedOutfitSnapshot {
  concept: string;
  items: SavedOutfitItemSnapshot[];
  visual?: {
    model_pose: string;
    outfit_details: string;
    background: string;
  };
}

export interface SavedOutfit {
  id: string;
  sourceMessageId: string | null;
  sourceConversationId: string | null;
  sourceOutfitId: string;
  title: string;
  coverImageUrl: string | null;
  snapshot: SavedOutfitSnapshot;
  eligibleForPlan: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 跳回对话中的来源消息 */
export function savedOutfitChatHref(item: Pick<SavedOutfit, 'sourceConversationId' | 'sourceMessageId'>): string | null {
  if (!item.sourceConversationId || !item.sourceMessageId) return null;
  const params = new URLSearchParams({
    c: item.sourceConversationId,
    m: item.sourceMessageId,
  });
  return `/?${params.toString()}`;
}

export async function fetchSavedOutfits(options?: {
  eligibleForPlan?: boolean;
  limit?: number;
  bust?: boolean;
}): Promise<SavedOutfit[]> {
  const params = new URLSearchParams();
  if (options?.eligibleForPlan) params.set('eligibleForPlan', 'true');
  if (options?.limit) params.set('limit', String(options.limit));
  const qs = params.toString();
  const url = qs ? `/api/saved-outfits?${qs}` : '/api/saved-outfits';
  const data = options?.bust
    ? ((await apiClient.getCached(url, { bust: true })) as { items: SavedOutfit[] })
    : ((await apiClient.get(url)) as { items: SavedOutfit[] });
  return data.items;
}

export async function saveOutfit(
  sourceMessageId: string,
  sourceOutfitId: string
): Promise<{ item: SavedOutfit; created: boolean }> {
  return apiClient.post('/api/saved-outfits', {
    sourceMessageId,
    sourceOutfitId,
  }) as Promise<{ item: SavedOutfit; created: boolean }>;
}

export async function deleteSavedOutfit(id: string): Promise<void> {
  await apiClient.delete(`/api/saved-outfits/${id}`);
}
