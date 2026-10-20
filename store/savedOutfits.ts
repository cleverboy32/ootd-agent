import { create } from 'zustand';
import { fetchSession } from '@/lib/api/auth';
import {
  deleteSavedOutfit,
  fetchSavedOutfits,
  saveOutfit,
  type SavedOutfit,
} from '@/lib/api/savedOutfits';
import { stripBasePath, withBasePath } from '@/lib/utils';

function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  const current = stripBasePath(window.location.pathname) + window.location.search;
  window.location.href = withBasePath(`/login?redirect=${encodeURIComponent(current)}`);
}

interface SavedOutfitsState {
  items: SavedOutfit[];
  loading: boolean;
  authenticated: boolean;
  /** 是否已完成至少一次 refresh（避免各页重复打） */
  hydrated: boolean;
}

interface SavedOutfitsActions {
  refresh: () => Promise<void>;
  getSavedId: (messageId: string, outfitId: string) => string | undefined;
  toggleSave: (messageId: string, outfitId: string) => Promise<void>;
  removeById: (id: string) => Promise<void>;
}

export const useSavedOutfitsStore = create<SavedOutfitsState & SavedOutfitsActions>((set, get) => ({
  items: [],
  loading: true,
  authenticated: false,
  hydrated: false,

  getSavedId: (messageId, outfitId) => {
    const hit = get().items.find(
      (item) => item.sourceMessageId === messageId && item.sourceOutfitId === outfitId
    );
    return hit?.id;
  },

  refresh: async () => {
    set({ loading: true });
    try {
      const session = await fetchSession();
      const ok = Boolean(session.authenticated && session.user);
      if (!ok) {
        set({ authenticated: false, items: [], loading: false, hydrated: true });
        return;
      }
      set({ authenticated: true });
      try {
        const list = await fetchSavedOutfits({ bust: true });
        set({ items: list, loading: false, hydrated: true });
      } catch (err) {
        console.error('[SAVED_OUTFITS] list failed', err);
        set({ items: [], loading: false, hydrated: true });
      }
    } catch {
      set({ authenticated: false, items: [], loading: false, hydrated: true });
    }
  },

  toggleSave: async (messageId, outfitId) => {
    let ok = get().authenticated;
    if (!ok) {
      try {
        const session = await fetchSession();
        ok = Boolean(session.authenticated && session.user);
        set({ authenticated: ok });
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      redirectToLogin();
      return;
    }

    const existing = get().items.find(
      (item) => item.sourceMessageId === messageId && item.sourceOutfitId === outfitId
    );
    if (existing) {
      await deleteSavedOutfit(existing.id);
      set({ items: get().items.filter((i) => i.id !== existing.id) });
      return;
    }

    const { item } = await saveOutfit(messageId, outfitId);
    set({
      items: [item, ...get().items.filter((i) => i.id !== item.id)],
    });
  },

  removeById: async (id) => {
    await deleteSavedOutfit(id);
    set({ items: get().items.filter((i) => i.id !== id) });
  },
}));
