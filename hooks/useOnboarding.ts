'use client';

import { useEffect } from 'react';
import { useChatStore } from '@/store/chat';
import { useOnboardingStore } from '@/store/onboarding';

/** 订阅全局引导状态；进入相关页面时 hydrate */
export function useOnboarding() {
  const conversations = useChatStore((s) => s.conversations);
  const hasConversations = conversations.length > 0;
  const ready = useOnboardingStore((s) => s.ready);
  const step = useOnboardingStore((s) => s.step);
  const progress = useOnboardingStore((s) => s.progress);
  const hydrate = useOnboardingStore((s) => s.hydrate);
  const dismissStore = useOnboardingStore((s) => s.dismiss);
  const completeChat = useOnboardingStore((s) => s.completeChat);

  useEffect(() => {
    void hydrate(hasConversations);
  }, [hasConversations, hydrate]);

  return {
    ready,
    step,
    progress,
    dismiss: () => dismissStore(hasConversations),
    completeChat,
    refresh: () => hydrate(hasConversations),
  };
}
