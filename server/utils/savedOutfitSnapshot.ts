import type { ClothingItem } from '@prisma/client';
import type { StylistOutfit } from '@/server/agents/stylist';
import type { ImageState } from '@/lib/types';
import type { StylistCacheNode } from '@/server/utils/messageContent';

export interface SavedOutfitItemSnapshot {
  wardrobeItemId?: string;
  name: string;
  layer: string;
  imageUrl?: string;
}

export interface SavedOutfitSnapshot {
  concept: string;
  items: SavedOutfitItemSnapshot[];
  visual?: StylistOutfit['visual_composition'];
}

export interface BuiltSavedOutfit {
  title: string;
  coverImageUrl: string | null;
  snapshot: SavedOutfitSnapshot;
}

function resolveCoverImageUrl(
  outfitId: string,
  imageStates: Record<string, ImageState>,
  itemImageUrls: Array<string | undefined>
): string | null {
  const state = imageStates[outfitId];
  if (typeof state === 'string' && state !== 'loading' && state !== 'failed') {
    return state;
  }
  return itemImageUrls.find((url): url is string => Boolean(url)) ?? null;
}

/** 从消息内的 stylist_cache + image_states 拼收藏快照（纯函数） */
export function buildSavedOutfitFromCache(
  stylistCache: StylistCacheNode,
  outfitId: string,
  imageStates: Record<string, ImageState>
): BuiltSavedOutfit | null {
  const outfit = stylistCache.stylist_result.outfits.find((o) => o.id === outfitId);
  if (!outfit) return null;

  const wardrobeById = new Map<string, ClothingItem>();
  for (const item of stylistCache.wardrobe_items ?? []) {
    wardrobeById.set(item.id, item);
  }

  const items: SavedOutfitItemSnapshot[] = outfit.selected_items.map((sel) => {
    const wardrobeItem =
      sel.id && sel.id !== 'new_item' ? wardrobeById.get(sel.id) : undefined;
    return {
      wardrobeItemId: wardrobeItem ? wardrobeItem.id : undefined,
      name: sel.name,
      layer: sel.layer,
      imageUrl: wardrobeItem?.imageUrl,
    };
  });

  return {
    title: outfit.overall_concept.trim() || '未命名搭配',
    coverImageUrl: resolveCoverImageUrl(
      outfitId,
      imageStates,
      items.map((i) => i.imageUrl)
    ),
    snapshot: {
      concept: outfit.overall_concept,
      items,
      visual: outfit.visual_composition,
    },
  };
}
