"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { ProfileOverview } from '@/components/profile/ProfileOverview';
import { StyleSection } from '@/components/profile/StyleSection';
import { VisualAnalysisSection } from '@/components/profile/VisualAnalysisSection';
import { fetchProfile, type ProfileData } from '@/lib/api/profile';
import { getFriendlyErrorMessage } from '@/lib/api/errorMessage';
import { ProfileErrorState } from '@/components/profile/ProfileErrorState';
import { Skeleton } from '@/components/ui/skeleton';
import { AppSidebar } from '@/components/AppSidebar';

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
      <AppSidebar activeSection="profile" />

      <div className="flex flex-col">
        <header className="flex h-14 items-center border-b px-4 lg:h-15 lg:px-6">
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
