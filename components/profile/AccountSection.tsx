"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { fetchSession, logout, type AuthUser } from '@/lib/api/auth';

/** 账号条：显示当前用户 + 安全中心/登出入口。access 模式（未启用登录体系）下不渲染 */
export function AccountSection() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    fetchSession()
      .then((state) => setUser(state.authenticated && state.user ? state.user : null))
      .catch(() => setUser(null));
  }, []);

  async function onLogout() {
    setPending(true);
    try {
      await logout();
      router.push('/login');
    } catch {
      setPending(false);
    }
  }

  if (!user) return null;

  return (
    <div className="flex items-center justify-between rounded-xl border bg-card p-4">
      <div className="text-sm">
        <span className="text-muted-foreground">当前账号：</span>
        <span className="font-medium text-foreground">{user.username}</span>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href="/settings/security">安全中心</Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={onLogout} disabled={pending}>
          {pending ? '退出中…' : '退出登录'}
        </Button>
      </div>
    </div>
  );
}
