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
  /** 当前 hydrate 对应的用户；切号时强制重拉 */
  userId: string | null;
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
  userId: null,
  step: 'done',
  progress: {
    hasWardrobe: false,
    hasFullBody: false,
    hasConversations: false,
  },

  hydrate: async (hasConversations, options) => {
    const force = options?.force === true;
    const { ready, progress, userId: hydratedUserId } = get();

    const session = useSessionStore.getState();
    const authenticated = session.ready
      ? session.authenticated
      : (await session.ensureSession().catch(() => null))?.authenticated === true;
    const userId = authenticated ? useSessionStore.getState().user?.id?.trim() || null : null;

    if (ready && !force && hydratedUserId === userId) {
      if (progress.hasConversations === hasConversations) return;
      if (!userId) {
        set({
          progress: { ...progress, hasConversations },
          step: 'done',
        });
        return;
      }
      const nextProgress = { ...progress, hasConversations };
      set({
        progress: nextProgress,
        step: resolveOnboardingStep(userId, nextProgress),
      });
      return;
    }

    if (hydrateInFlight && !force && hydratedUserId === userId) {
      await hydrateInFlight;
      const after = get();
      if (after.userId === userId && after.progress.hasConversations !== hasConversations) {
        if (!userId) {
          set({
            progress: { ...after.progress, hasConversations },
            step: 'done',
          });
          return;
        }
        const nextProgress = { ...after.progress, hasConversations };
        set({
          progress: nextProgress,
          step: resolveOnboardingStep(userId, nextProgress),
        });
      }
      return;
    }

    const run = (async () => {
      if (!authenticated || !userId) {
        const guestProgress: OnboardingProgress = {
          hasWardrobe: false,
          hasFullBody: false,
          hasConversations,
        };
        set({
          ready: true,
          userId: null,
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
        userId,
        progress: nextProgress,
        step: resolveOnboardingStep(userId, nextProgress),
      });
    })();

    hydrateInFlight = run.finally(() => {
      hydrateInFlight = null;
    });
    await hydrateInFlight;
  },

  dismiss: (hasConversations) => {
    const { step, progress, userId } = get();
    if (!userId) return;
    const nextProgress = { ...progress, hasConversations };
    const next = dismissOnboardingStep(userId, step, nextProgress);
    set({ step: next, progress: nextProgress });
  },

  completeChat: () => {
    const { userId } = get();
    if (!userId) return;
    completeChatOnboarding(userId);
    set({ step: 'done' });
  },
}));
