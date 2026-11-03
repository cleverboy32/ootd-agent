'use client';

import { GuideBubble } from '@/components/onboarding/GuideBubble';
import { useOnboarding } from '@/hooks/useOnboarding';

type WardrobeGuideBubbleProps = {
  onAddItems?: () => void;
};

/** 衣橱页固定引导：步骤 1 上传衣物（避免被 overflow 裁切） */
export function WardrobeGuideBubble({ onAddItems }: WardrobeGuideBubbleProps) {
  const { ready, step, dismiss } = useOnboarding();

  if (!ready || step !== 'wardrobe') return null;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 md:bottom-8 md:right-8">
      <div
        className="pointer-events-auto cursor-pointer"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          onAddItems?.();
        }}
      >
        <GuideBubble
          title="先上传几件常穿衣物"
          onDismiss={dismiss}
          arrow="none"
        />
      </div>
    </div>
  );
}
