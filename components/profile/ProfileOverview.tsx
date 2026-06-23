"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { computeProfileCompleteness, type ProfileData } from '@/lib/api/profile';

interface ProfileOverviewProps {
  profile: ProfileData;
}

function displayValue(value: string | undefined, fallback = '未设置') {
  return value?.trim() ? value : fallback;
}

export function ProfileOverview({ profile }: ProfileOverviewProps) {
  const { filled, total } = computeProfileCompleteness(profile);
  const percent = Math.round((filled / total) * 100);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>档案概览</CardTitle>
        <CardDescription>由 AI 在对话中自动积累的基础信息</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1">昵称</p>
            <p className="font-medium">{displayValue(profile.name)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">身高</p>
            <p className="font-medium">{displayValue(profile.height)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">体重</p>
            <p className="font-medium">{displayValue(profile.weight)}</p>
          </div>
        </div>

        {profile.location?.trim() && (
          <div>
            <p className="text-xs text-muted-foreground mb-1">所在地</p>
            <p className="font-medium">{profile.location}</p>
          </div>
        )}

        <div className="rounded-lg bg-muted/50 p-3">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-muted-foreground">档案完整度</span>
            <span className="font-medium">{percent}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            已与 AI 聊过 {filled}/{total} 项关键信息
            {!profile.visual_profile_verified && '，上传自拍可补全外形分析'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
