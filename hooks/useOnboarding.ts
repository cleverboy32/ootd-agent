'use client';

import { useCallback, useEffect } from 'react';
import { useChatStore } from '@/store/chat';
import { useOnboardingStore } from '@/store/onboarding';
import { useSessionStore } from '@/store/session';

/** 订阅全局引导状态；hydrate 在 store 内去重，多组件挂载只会打一次网 */
export function useOnboarding() {
  const conversations = useChatStore((s) => s.conversations);
  const hasConversations = conversations.length > 0;
  const sessionUserId = useSessionStore((s) => s.user?.id ?? null);
  const ready = useOnboardingStore((s) => s.ready);
  const step = useOnboardingStore((s) => s.step);
  const progress = useOnboardingStore((s) => s.progress);
  const hydrate = useOnboardingStore((s) => s.hydrate);
  const dismissStore = useOnboardingStore((s) => s.dismiss);
  const completeChat = useOnboardingStore((s) => s.completeChat);

  useEffect(() => {
    void hydrate(hasConversations);
  }, [hasConversations, hydrate, sessionUserId]);

  const dismiss = useCallback(
    () => dismissStore(hasConversations),
    [dismissStore, hasConversations]
  );

  // 必须稳定引用：DisplayView 等会把 refresh 放进 useEffect deps，
  // 内联箭头每次 render 都变 → 拉衣橱 → force hydrate → 再 render → 死循环刷 /api/wardrobe
  const refresh = useCallback(
    () => hydrate(hasConversations, { force: true }),
    [hasConversations, hydrate]
  );

  return {
    ready,
    step,
    progress,
    dismiss,
    completeChat,
    refresh,
  };
}
