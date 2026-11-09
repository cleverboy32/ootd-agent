import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  onboardingStorageKey,
  readOnboardingStep,
  resolveOnboardingStep,
  writeOnboardingStep,
} from '@/lib/onboarding';

const memory = new Map<string, string>();

const localStorageMock = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
  clear: () => memory.clear(),
};

describe('onboarding storage is scoped by user id', () => {
  afterEach(() => {
    memory.clear();
    // @ts-expect-error test shim
    delete globalThis.localStorage;
  });

  it('uses distinct keys per user and does not share done state', () => {
    // @ts-expect-error test shim
    globalThis.localStorage = localStorageMock;
    // @ts-expect-error test shim
    globalThis.window = globalThis;

    assert.equal(onboardingStorageKey('user-a'), 'ootd-onboarding-step:user-a');
    writeOnboardingStep('user-a', 'done');
    writeOnboardingStep('user-b', 'wardrobe');

    assert.equal(readOnboardingStep('user-a'), 'done');
    assert.equal(readOnboardingStep('user-b'), 'wardrobe');

    const progress = {
      hasWardrobe: false,
      hasFullBody: false,
      hasConversations: false,
    };
    assert.equal(resolveOnboardingStep('user-a', progress), 'done');
    assert.equal(resolveOnboardingStep('user-b', progress), 'wardrobe');
  });
});
