'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { LogOut, Shirt, UserCircle, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchSession, logout } from '@/lib/api/auth';
import { withBasePath } from '@/lib/utils';

export function ChatHeader() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    fetchSession()
      .then((state) => setAuthenticated(Boolean(state.authenticated && state.user)))
      .catch(() => setAuthenticated(false));
  }, []);

  async function onLogout() {
    setLoggingOut(true);
    try {
      await logout();
      window.location.assign(withBasePath('/login'));
    } catch {
      setLoggingOut(false);
    }
  }

  return (
    <header className="relative z-20 h-14 flex items-center justify-between px-6 bg-background/80 backdrop-blur-sm sticky top-0 border-b border-border/40">
      <h2 className="font-semibold text-foreground">AI 时尚搭配助手</h2>

      <div className="flex items-center gap-1">
        <Link href="/wardrobe" passHref>
          <Button variant="ghost" className="flex items-center gap-2">
            <Shirt className="h-5 w-5" />
            <span className="hidden sm:inline">我的衣橱</span>
          </Button>
        </Link>

        <div className="relative group">
          <Button
            variant="ghost"
            className="flex items-center gap-2"
            aria-haspopup="menu"
            aria-label="我的"
          >
            <UserCircle className="h-5 w-5" />
            <span className="hidden sm:inline">我的</span>
          </Button>

          <div
            role="menu"
            className="invisible absolute right-0 top-full z-50 pt-1 opacity-0 transition-[opacity,visibility] duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
          >
            <div className="min-w-40 rounded-xl border border-border bg-background p-1 shadow-md">
              <Link
                href="/profile"
                role="menuitem"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
              >
                <UserCircle className="h-4 w-4 text-muted-foreground" />
                我的档案
              </Link>
              <Link
                href="/settings/security"
                role="menuitem"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
              >
                <Shield className="h-4 w-4 text-muted-foreground" />
                安全中心
              </Link>
              {authenticated && (
                <>
                  <div className="my-1 h-px bg-border" />
                  <button
                    type="button"
                    role="menuitem"
                    disabled={loggingOut}
                    onClick={() => void onLogout()}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    <LogOut className="h-4 w-4 text-muted-foreground" />
                    {loggingOut ? '退出中…' : '退出登录'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
