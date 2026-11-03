import { create } from 'zustand';
import { apiClient } from '@/lib/api-client';
import { fetchProfile } from '@/lib/api/profile';
import { useSessionStore } from '@/store/session';
import {
  completeChatOnboarding,
  dismissOnboardingStep,
  resolveOnboardingStep,
  type OnboardingProgress,
  type OnboardingStep,
} from '@/lib/onboarding';

type HydrateOptions = { force?: boolean };

type OnboardingStore = {
  ready: boolean;
  step: OnboardingStep;
  progress: OnboardingProgress;
  hydrate: (hasConversations: boolean, options?: HydrateOptions) => Promise<void>;
  dismiss: (hasConversations: boolean) => void;
  completeChat: () => void;
};

/** 并发 hydrate 共用同一 Promise；ready 后只同步 hasConversations，不重复打网 */
let hydrateInFlight: Promise<void> | null = null;

export const useOnboardingStore = create<OnboardingStore>((set, get) => ({
  ready: false,
  step: 'done',
  progress: {
    hasWardrobe: false,
    hasFullBody: false,
    hasConversations: false,
  },

  hydrate: async (hasConversations, options) => {
    const force = options?.force === true;
    const { ready, progress } = get();

    if (ready && !force) {
      if (progress.hasConversations === hasConversations) return;
      const nextProgress = { ...progress, hasConversations };
      set({
        progress: nextProgress,
        step: resolveOnboardingStep(nextProgress),
      });
      return;
    }

    if (hydrateInFlight && !force) {
      await hydrateInFlight;
      const after = get();
      if (after.progress.hasConversations !== hasConversations) {
        const nextProgress = { ...after.progress, hasConversations };
        set({
          progress: nextProgress,
          step: resolveOnboardingStep(nextProgress),
        });
      }
      return;
    }

    const run = (async () => {
      const session = useSessionStore.getState();
      const authenticated = session.ready
        ? session.authenticated
        : (await session.ensureSession().catch(() => null))?.authenticated === true;

      if (!authenticated) {
        const guestProgress: OnboardingProgress = {
          hasWardrobe: false,
          hasFullBody: false,
          hasConversations,
        };
        set({
          ready: true,
          progress: guestProgress,
          step: 'done',
        });
        return;
      }

      const [wardrobe, profile] = await Promise.all([
        apiClient.get('/api/wardrobe').catch(() => []),
        fetchProfile().catch(() => null),
      ]);
      const items = Array.isArray(wardrobe) ? wardrobe : [];
      const nextProgress: OnboardingProgress = {
        hasWardrobe: items.length > 0,
        hasFullBody: profile?.full_body_verified === true,
        hasConversations,
      };
      set({
        ready: true,
        progress: nextProgress,
        step: resolveOnboardingStep(nextProgress),
      });
    })();

    hydrateInFlight = run.finally(() => {
      hydrateInFlight = null;
    });
    await hydrateInFlight;
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
