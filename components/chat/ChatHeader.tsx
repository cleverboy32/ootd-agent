'use client';

import React, { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Heart, LogOut, Shirt, Sparkles, UserCircle, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GuideBubble } from '@/components/onboarding/GuideBubble';
import { useAccess } from '@/components/access/AccessProvider';
import { useAuthModal } from '@/components/auth/AuthModalProvider';
import { useOnboarding } from '@/hooks/useOnboarding';
import { readLoginPromoDismissed, writeLoginPromoDismissed } from '@/lib/guestAccess';

const emptySubscribe = () => () => {};

export function ChatHeader() {
  const { ready: accessReady, authenticated, logout } = useAccess();
  const { openAuthModal } = useAuthModal();
  const {
    ready: onboardingReady,
    step: onboardingStep,
    progress: onboardingProgress,
    dismiss: dismissOnboarding,
  } = useOnboarding();
  const [loggingOut, setLoggingOut] = useState(false);
  const needsFullBody = onboardingReady && !onboardingProgress.hasFullBody;
  const [loginPromoDismissedLocal, setLoginPromoDismissedLocal] = useState(false);
  const loginPromoStoredDismissed = useSyncExternalStore(
    emptySubscribe,
    readLoginPromoDismissed,
    () => true
  );
  const showFullBodyGuide =
    authenticated && onboardingReady && onboardingStep === 'fullBody';
  const showWardrobeGuide =
    authenticated && onboardingReady && onboardingStep === 'wardrobe';
  const showLoginPromo =
    accessReady &&
    !authenticated &&
    !loginPromoStoredDismissed &&
    !loginPromoDismissedLocal;

  async function onLogout() {
    setLoggingOut(true);
    try {
      await logout();
      // AccessProvider.logout 负责跳首页或 /login
    } catch {
      setLoggingOut(false);
    }
  }

  function dismissLoginPromo() {
    writeLoginPromoDismissed();
    setLoginPromoDismissedLocal(true);
  }

  return (
    <header className="relative z-20 h-14 flex items-center justify-between px-6 bg-background/80 backdrop-blur-sm sticky top-0 border-b border-border/40">
      <h2 className="font-semibold text-foreground">AI 时尚搭配助手</h2>

      <div className="flex items-center gap-1">
        {authenticated ? (
          <>
            <div className="relative">
              <Link href="/wardrobe" passHref>
                <Button variant="ghost" className="flex items-center gap-2">
                  <Shirt className="h-5 w-5" />
                  <span className="hidden sm:inline">我的衣橱</span>
                </Button>
              </Link>
              {showWardrobeGuide && (
                <div className="absolute right-0 top-full z-50 mt-2">
                  <GuideBubble
                    title="先去衣橱上传几件衣服"
                    onDismiss={dismissOnboarding}
                    arrow="top"
                    arrowAlign="end"
                  />
                </div>
              )}
            </div>

            <div className="relative group">
              <Button
                variant="ghost"
                className={`relative flex items-center gap-2 ${needsFullBody ? 'pr-4' : ''}`}
                aria-haspopup="menu"
                aria-label={needsFullBody ? '我的，有一条新提示' : '我的'}
              >
                <UserCircle className="h-5 w-5" />
                <span className="hidden sm:inline">我的</span>
                {needsFullBody && (
                  <span
                    className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-red-500"
                    aria-hidden
                  />
                )}
              </Button>
              {showFullBodyGuide && (
                <div className="absolute right-0 top-full z-[60] mt-2">
                  <GuideBubble
                    title="上传一张全身照"
                    description="效果图会更像你"
                    onDismiss={dismissOnboarding}
                    arrow="top"
                    arrowAlign="end"
                  />
                </div>
              )}

              <div
                role="menu"
                className="invisible absolute right-0 top-full z-50 pt-1 opacity-0 transition-[opacity,visibility] duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
              >
                <div className="min-w-40 rounded-xl border border-border bg-background p-1 shadow-md">
                  <Link
                    href="/collect"
                    role="menuitem"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
                  >
                    <Heart className="h-4 w-4 text-muted-foreground" />
                    我的搭配
                  </Link>
                  <div className="relative">
                    <Link
                      href="/profile#visual-analysis"
                      role="menuitem"
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
                    >
                      <UserCircle className="h-4 w-4 text-muted-foreground" />
                      我的档案
                    </Link>
                    {needsFullBody && (
                      <div className="pointer-events-none absolute right-full top-1/2 z-10 mr-2 w-max max-w-52 -translate-y-1/2">
                        <div className="relative rounded-2xl rounded-br-sm bg-foreground px-3 py-2 text-xs leading-relaxed text-background shadow-md">
                          去上传一张站立、至少拍到膝盖的照片，效果图里的人会更像你
                          <span
                            className="absolute top-1/2 -right-1 size-2 -translate-y-1/2 rotate-45 bg-foreground"
                            aria-hidden
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <Link
                    href="/settings/credits"
                    role="menuitem"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
                  >
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                    账单
                  </Link>
                  <Link
                    href="/settings/security"
                    role="menuitem"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
                  >
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    安全中心
                  </Link>
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
                </div>
              </div>
            </div>
          </>
        ) : accessReady ? (
          <div className="relative">
            <Button
              variant="ghost"
              className="flex items-center gap-2"
              onClick={() => openAuthModal({ redirect: '/' })}
            >
              <UserCircle className="h-5 w-5" />
              <span className="hidden sm:inline">登录</span>
            </Button>
            {showLoginPromo && (
              <div className="absolute right-0 top-full z-50 mt-2">
                <GuideBubble
                  title="登录领每日免费积分"
                  description="解锁专属穿搭与效果图"
                  onDismiss={dismissLoginPromo}
                  arrow="top"
                  arrowAlign="end"
                />
              </div>
            )}
          </div>
        ) : null}
      </div>
    </header>
  );
}
