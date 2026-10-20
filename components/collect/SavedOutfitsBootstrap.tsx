'use client';

import { useEffect } from 'react';
import { useSavedOutfitsStore } from '@/store/savedOutfits';

/** 根布局挂载一次：拉取收藏列表进 zustand（替代旧 Context Provider） */
export function SavedOutfitsBootstrap() {
  const refresh = useSavedOutfitsStore((s) => s.refresh);
  const hydrated = useSavedOutfitsStore((s) => s.hydrated);

  useEffect(() => {
    if (hydrated) return;
    void refresh();
  }, [hydrated, refresh]);

  return null;
}
