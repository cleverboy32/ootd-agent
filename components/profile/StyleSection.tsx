"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProfileData } from '@/lib/api/profile';

interface StyleSectionProps {
  profile: ProfileData;
}

export function StyleSection({ profile }: StyleSectionProps) {
  const hasStyle =
    (profile.personal_style?.trim() && profile.personal_style !== '日常休闲') ||
    profile.preferences.length > 0;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>风格档案</CardTitle>
        <CardDescription>长期穿衣偏好与个人风格定位</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {profile.personal_style?.trim() && (
          <div>
            <p className="text-xs text-muted-foreground mb-1">个人风格</p>
            <p className="text-sm leading-relaxed">{profile.personal_style}</p>
          </div>
        )}

        {profile.preferences.length > 0 ? (
          <div>
            <p className="text-xs text-muted-foreground mb-2">风格偏好</p>
            <div className="flex flex-wrap gap-2">
              {profile.preferences.map((pref) => (
                <span
                  key={pref}
                  className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
                >
                  {pref}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {!hasStyle && (
          <p className="text-sm text-muted-foreground">
            继续和 AI 聊天，我会慢慢了解你的穿衣偏好
          </p>
        )}
      </CardContent>
    </Card>
  );
}
