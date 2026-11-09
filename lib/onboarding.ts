/** 新用户顺序引导：衣橱 → 全身照 → 穿搭气泡 */

export type OnboardingStep = 'wardrobe' | 'fullBody' | 'chat' | 'done';

const STORAGE_KEY_PREFIX = 'ootd-onboarding-step';

export type OnboardingProgress = {
  hasWardrobe: boolean;
  hasFullBody: boolean;
  hasConversations: boolean;
};

export function onboardingStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}:${userId.trim()}`;
}

export function readOnboardingStep(userId: string): OnboardingStep | null {
  if (typeof window === 'undefined') return null;
  const id = userId.trim();
  if (!id) return null;
  const raw = localStorage.getItem(onboardingStorageKey(id));
  if (raw === 'wardrobe' || raw === 'fullBody' || raw === 'chat' || raw === 'done') {
    return raw;
  }
  return null;
}

export function writeOnboardingStep(userId: string, step: OnboardingStep): void {
  if (typeof window === 'undefined') return;
  const id = userId.trim();
  if (!id) return;
  localStorage.setItem(onboardingStorageKey(id), step);
}

/** 关闭当前步后进入下一步（可跳过已完成条件） */
export function nextAfterDismiss(
  current: OnboardingStep,
  progress: OnboardingProgress
): OnboardingStep {
  if (current === 'wardrobe') {
    if (!progress.hasFullBody) return 'fullBody';
    if (!progress.hasConversations) return 'chat';
    return 'done';
  }
  if (current === 'fullBody') {
    if (!progress.hasConversations) return 'chat';
    return 'done';
  }
  return 'done';
}

/**
 * 根据进度与本地记录解析当前应展示的步。
 * 首次访问从 wardrobe 起；已有数据则自动跳过。
 */
export function resolveOnboardingStep(
  userId: string,
  progress: OnboardingProgress
): OnboardingStep {
  const stored = readOnboardingStep(userId);
  if (stored === 'done') return 'done';

  let step: OnboardingStep = stored ?? 'wardrobe';

  if (step === 'wardrobe' && progress.hasWardrobe) {
    step = nextAfterDismiss('wardrobe', progress);
  }
  if (step === 'fullBody' && progress.hasFullBody) {
    step = nextAfterDismiss('fullBody', progress);
  }
  if (step === 'chat' && progress.hasConversations) {
    step = 'done';
  }

  if (stored !== step) writeOnboardingStep(userId, step);
  return step;
}

export function dismissOnboardingStep(
  userId: string,
  current: OnboardingStep,
  progress: OnboardingProgress
): OnboardingStep {
  const next = nextAfterDismiss(current, progress);
  writeOnboardingStep(userId, next);
  return next;
}

export function completeChatOnboarding(userId: string): void {
  writeOnboardingStep(userId, 'done');
}
