import { create } from 'zustand';
import { apiClient } from '@/lib/api-client';
import { fetchProfile } from '@/lib/api/profile';
import {
  completeChatOnboarding,
  dismissOnboardingStep,
  resolveOnboardingStep,
  type OnboardingProgress,
  type OnboardingStep,
} from '@/lib/onboarding';

type OnboardingStore = {
  ready: boolean;
  step: OnboardingStep;
  progress: OnboardingProgress;
  hydrate: (hasConversations: boolean) => Promise<void>;
  dismiss: (hasConversations: boolean) => void;
  completeChat: () => void;
};

export const useOnboardingStore = create<OnboardingStore>((set, get) => ({
  ready: false,
  step: 'done',
  progress: {
    hasWardrobe: false,
    hasFullBody: false,
    hasConversations: false,
  },

  hydrate: async (hasConversations) => {
    const [wardrobe, profile] = await Promise.all([
      apiClient.get('/api/wardrobe').catch(() => []),
      fetchProfile().catch(() => null),
    ]);
    const items = Array.isArray(wardrobe) ? wardrobe : [];
    const progress: OnboardingProgress = {
      hasWardrobe: items.length > 0,
      hasFullBody: profile?.full_body_verified === true,
      hasConversations,
    };
    const step = resolveOnboardingStep(progress);
    set({ ready: true, progress, step });
  },

  dismiss: (hasConversations) => {
    const { step, progress } = get();
    const nextProgress = { ...progress, hasConversations };
    const next = dismissOnboardingStep(step, nextProgress);
    set({ step: next, progress: nextProgress });
  },

  completeChat: () => {
    completeChatOnboarding();
    set({ step: 'done' });
  },
}));
