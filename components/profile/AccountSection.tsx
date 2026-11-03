'use client';

import { useAccess } from '@/components/access/AccessProvider';

/** 账号条：显示当前登录用户名 */
export function AccountSection() {
  const { ready, authenticated, user } = useAccess();

  if (!ready || !authenticated || !user) return null;

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-sm">
        <span className="text-muted-foreground">当前账号：</span>
        <span className="font-medium text-foreground">{user.username}</span>
      </div>
    </div>
  );
}
