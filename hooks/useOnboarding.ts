'use client';

import { useEffect } from 'react';
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

  return {
    ready,
    step,
    progress,
    dismiss: () => dismissStore(hasConversations),
    completeChat,
    refresh: () => hydrate(hasConversations, { force: true }),
  };
}
