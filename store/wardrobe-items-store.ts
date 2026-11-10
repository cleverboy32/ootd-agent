'use client';

import { create } from 'zustand';
import type { ClothingItem } from '@prisma/client';
import { withBasePath } from '@/lib/utils';
import { useSessionStore } from '@/store/session';

type EnsureOptions = { force?: boolean };

type WardrobeItemsStore = {
  items: ClothingItem[];
  userId: string | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  ensureLoaded: (options?: EnsureOptions) => Promise<void>;
  upsert: (item: ClothingItem) => void;
  removeIds: (ids: string[]) => void;
  reset: () => void;
};

/** 并发 ensureLoaded 共用同一 Promise，避免多组件同时打 /api/wardrobe */
let loadInFlight: Promise<void> | null = null;

async function resolveSessionUserId(): Promise<string | null> {
  const session = useSessionStore.getState();
  const authenticated = session.ready
    ? session.authenticated
    : (await session.ensureSession().catch(() => null))?.authenticated === true;
  if (!authenticated) return null;
  return useSessionStore.getState().user?.id?.trim() || null;
}

async function fetchWardrobeItems(): Promise<ClothingItem[]> {
  const response = await fetch(withBasePath('/api/wardrobe'), {
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('获取衣橱物品失败。');
  const data: unknown = await response.json();
  return Array.isArray(data) ? (data as ClothingItem[]) : [];
}

export const useWardrobeItemsStore = create<WardrobeItemsStore>((set, get) => ({
  items: [],
  userId: null,
  loaded: false,
  loading: false,
  error: null,

  ensureLoaded: async (options) => {
    const force = options?.force === true;
    const userId = await resolveSessionUserId();

    if (!userId) {
      set({ items: [], userId: null, loaded: true, loading: false, error: null });
      return;
    }

    const { loaded, userId: cachedUserId } = get();
    if (!force && loaded && cachedUserId === userId) return;
    if (!force && loadInFlight) {
      await loadInFlight;
      const after = get();
      if (after.loaded && after.userId === userId) return;
    }

    if (force && loadInFlight) {
      await loadInFlight;
    }

    if (!force && get().loaded && get().userId === userId) return;
    if (!force && loadInFlight) {
      await loadInFlight;
      return;
    }

    const request = (async () => {
      set({ loading: true, error: null });
      try {
        const items = await fetchWardrobeItems();
        set({
          items,
          userId,
          loaded: true,
          loading: false,
          error: null,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        set({ loading: false, error: message });
        throw err;
      }
    })().finally(() => {
      if (loadInFlight === request) loadInFlight = null;
    });

    loadInFlight = request;
    await request;
  },

  upsert: (item) => {
    set((state) => {
      const idx = state.items.findIndex((entry) => entry.id === item.id);
      if (idx === -1) {
        return { items: [item, ...state.items], loaded: true };
      }
      const next = state.items.slice();
      next[idx] = { ...next[idx], ...item };
      return { items: next };
    });
  },

  removeIds: (ids) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    set((state) => ({
      items: state.items.filter((item) => !idSet.has(item.id)),
    }));
  },

  reset: () => {
    loadInFlight = null;
    set({
      items: [],
      userId: null,
      loaded: false,
      loading: false,
      error: null,
    });
  },
}));
