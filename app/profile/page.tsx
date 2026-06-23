"use client";

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { MessageSquare, LayoutDashboard, PlusSquare, UserCircle } from 'lucide-react';
import { ProfileOverview } from '@/components/profile/ProfileOverview';
import { StyleSection } from '@/components/profile/StyleSection';
import { VisualAnalysisSection } from '@/components/profile/VisualAnalysisSection';
import { fetchProfile, type ProfileData } from '@/lib/api/profile';
import { getFriendlyErrorMessage } from '@/lib/api/errorMessage';
import { ProfileErrorState } from '@/components/profile/ProfileErrorState';
import { Skeleton } from '@/components/ui/skeleton';

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');

  // Initial load — no synchronous setState before first await (avoids react-hooks/set-state-in-effect)
  useEffect(() => {
    fetchProfile()
      .then((data) => {
        setProfile(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(getFriendlyErrorMessage(err, '加载档案失败，请稍后重试'));
        setProfile(null);
        setLoading(false);
      });
  }, []);

  const loadProfile = useCallback(async (isRetry = false) => {
    if (isRetry) setRetrying(true);
    setError('');
    try {
      const data = await fetchProfile();
      setProfile(data);
    } catch (err) {
      setError(getFriendlyErrorMessage(err, '加载档案失败，请稍后重试'));
      setProfile(null);
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, []);

  return (
    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      <div className="hidden border-r bg-muted/40 md:block">
        <div className="flex h-full max-h-screen flex-col gap-2">
          <div className="flex h-14 items-center px-4 lg:h-[60px] lg:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <Image src="/logo.png" alt="Fashion AI Logo" width={28} height={28} className="rounded-md" />
              <span className="font-semibold text-lg tracking-tight">Fashion AI</span>
            </Link>
          </div>
          <div className="flex-1">
            <nav className="grid items-start gap-1 px-2 text-sm font-medium lg:px-4">
              <Link
                href="/"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary"
              >
                <MessageSquare className="h-4 w-4" />
                AI 搭配
              </Link>
              <Link
                href="/wardrobe"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary"
              >
                <LayoutDashboard className="h-4 w-4" />
                衣橱总览
              </Link>
              <Link
                href="/wardrobe"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary"
              >
                <PlusSquare className="h-4 w-4" />
                添加衣物
              </Link>
              <span className="flex w-full items-center gap-3 rounded-lg px-3 py-2 bg-muted text-primary">
                <UserCircle className="h-4 w-4" />
                我的档案
              </span>
            </nav>
          </div>
        </div>
      </div>

      <div className="flex flex-col">
        <header className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
          <h1 className="text-lg font-semibold">我的档案</h1>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {loading && (
            <div className="space-y-4 w-full">
              <Skeleton className="h-48 w-full rounded-xl" />
              <Skeleton className="h-36 w-full rounded-xl" />
              <Skeleton className="h-56 w-full rounded-xl" />
            </div>
          )}

          {error && !loading && (
            <ProfileErrorState
              message={error}
              onRetry={() => void loadProfile(true)}
              retryLabel="重新加载"
              retrying={retrying}
            />
          )}

          {!loading && profile && (
            <div className="space-y-6 w-full">
              <ProfileOverview profile={profile} />
              <VisualAnalysisSection
                profile={profile}
                onProfileUpdated={setProfile}
              />
              <StyleSection profile={profile} />
              <p className="text-xs text-muted-foreground pb-6">
                基础信息与风格偏好由对话自动积累；外形分析需您主动上传自拍后生成
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
