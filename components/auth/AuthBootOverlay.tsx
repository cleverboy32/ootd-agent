'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Loader2 } from 'lucide-react';
import { useAccess } from '@/components/access/AccessProvider';
import { clearAuthBoot, readAuthBootLabel } from '@/lib/authBoot';

const emptySubscribe = () => () => {};

/**
 * 只在「刚登录/退出」刷新后出现顶部轻提示，
 * 普通进站不再全屏遮罩。
 */
export function AuthBootOverlay() {
  const { ready } = useAccess();
  const label = useSyncExternalStore(emptySubscribe, readAuthBootLabel, () => null);

  useEffect(() => {
    if (!ready) return;
    clearAuthBoot();
  }, [ready]);

  if (ready || !label) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] flex justify-center pt-3"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
        <Loader2 className="size-3.5 animate-spin text-[var(--gold)]" aria-hidden />
        <span>{label}</span>
      </div>
    </div>
  );
}
