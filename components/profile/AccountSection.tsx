'use client';

import { useEffect, useState } from 'react';
import { fetchSession, type AuthUser } from '@/lib/api/auth';

/** 账号条：显示当前用户。access 模式（未启用登录体系）下不渲染 */
export function AccountSection() {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    fetchSession()
      .then((state) => setUser(state.authenticated && state.user ? state.user : null))
      .catch(() => setUser(null));
  }, []);

  if (!user) return null;

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-sm">
        <span className="text-muted-foreground">当前账号：</span>
        <span className="font-medium text-foreground">{user.username}</span>
      </div>
    </div>
  );
}
