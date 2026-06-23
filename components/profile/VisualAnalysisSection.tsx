"use client";

import React, { ChangeEvent, useRef, useState } from 'react';
import Image from 'next/image';
import { Upload, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { uploadFileToGCS } from '@/lib/utils';
import { analyzeVisualProfile, type ProfileData } from '@/lib/api/profile';
import { getFriendlyErrorMessage } from '@/lib/api/errorMessage';
import { ProfileErrorState } from '@/components/profile/ProfileErrorState';

interface VisualAnalysisSectionProps {
  profile: ProfileData;
  onProfileUpdated: (profile: ProfileData) => void;
}

export function VisualAnalysisSection({ profile, onProfileUpdated }: VisualAnalysisSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFileRef = useRef<File | null>(null);
  const pendingImageUrlRef = useRef<string | null>(null);

  const [status, setStatus] = useState<'idle' | 'uploading' | 'analyzing' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [retryMode, setRetryMode] = useState<'upload' | 'analyze'>('upload');

  const isBusy = status === 'uploading' || status === 'analyzing';
  const isVerified = Boolean(profile.visual_profile_verified);

  const analyzeUploadedImage = async (publicUrl: string) => {
    setStatus('analyzing');
    setErrorMessage('');
    pendingImageUrlRef.current = publicUrl;

    try {
      const updated = await analyzeVisualProfile(publicUrl);
      onProfileUpdated(updated);
      pendingImageUrlRef.current = null;
      setStatus('idle');
    } catch (error) {
      setRetryMode('analyze');
      setErrorMessage(
        getFriendlyErrorMessage(error, '外形分析失败，请稍后重试')
      );
      setStatus('error');
    }
  };

  const uploadAndAnalyze = async (file: File) => {
    lastFileRef.current = file;
    setErrorMessage('');
    setStatus('uploading');

    try {
      const publicUrl = await uploadFileToGCS(file);
      await analyzeUploadedImage(publicUrl);
    } catch (error) {
      setRetryMode('upload');
      setErrorMessage(
        getFriendlyErrorMessage(error, '照片上传失败，请检查网络后重试')
      );
      setStatus('error');
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void uploadAndAnalyze(file);
  };

  const handleRetry = () => {
    if (retryMode === 'analyze' && pendingImageUrlRef.current) {
      void analyzeUploadedImage(pendingImageUrlRef.current);
      return;
    }
    if (lastFileRef.current) {
      void uploadAndAnalyze(lastFileRef.current);
      return;
    }
    triggerUpload();
  };

  const triggerUpload = () => inputRef.current?.click();

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>外形分析</CardTitle>
        <CardDescription>
          上传自拍后，AI 将分析肤色、身材与外形特征，用于更精准的搭配推荐
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'error' && errorMessage && (
          <ProfileErrorState
            message={errorMessage}
            onRetry={handleRetry}
            retryLabel={retryMode === 'analyze' ? '重新分析' : '重新上传'}
            retrying={isBusy}
          />
        )}

        {isVerified ? (
          <div className="space-y-4">
            {profile.selfie_image_url && (
              <div className="relative w-32 h-40 rounded-lg overflow-hidden border">
                <Image
                  src={profile.selfie_image_url}
                  alt="参考自拍"
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>
            )}

            {profile.skin_tone?.trim() && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">肤色分析</p>
                <p className="text-sm leading-relaxed">{profile.skin_tone}</p>
              </div>
            )}

            {profile.body_shape?.trim() && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">身材分析</p>
                <p className="text-sm leading-relaxed">{profile.body_shape}</p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {profile.visual_features.hair_color &&
                profile.visual_features.hair_color !== 'unknown' && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">发色</p>
                    <p className="text-sm">{profile.visual_features.hair_color}</p>
                  </div>
                )}
              {profile.visual_features.detected_features &&
                profile.visual_features.detected_features !== 'none' && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">外形特征</p>
                    <p className="text-sm">{profile.visual_features.detected_features}</p>
                  </div>
                )}
            </div>

            {profile.selfie_analyzed_at && (
              <p className="text-xs text-muted-foreground">
                分析于 {new Date(profile.selfie_analyzed_at).toLocaleString('zh-CN')}
              </p>
            )}

            <Button variant="outline" size="sm" onClick={triggerUpload} disabled={isBusy}>
              {isBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              重新上传
            </Button>
          </div>
        ) : status !== 'error' ? (
          <div className="flex w-full flex-col items-start gap-4 p-6 border border-dashed rounded-lg">
            {isBusy ? (
              <div className="flex items-center gap-3 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">
                  {status === 'uploading' ? '正在上传照片…' : '正在分析您的外形特征…'}
                </span>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  请上传一张清晰的正面半身或全身自拍，帮助 AI 了解您的肤色与身材特点
                </p>
                <Button onClick={triggerUpload}>
                  <Upload className="mr-2 h-4 w-4" />
                  上传自拍
                </Button>
              </>
            )}
          </div>
        ) : null}

        <Input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="sr-only"
          disabled={isBusy}
        />
      </CardContent>
    </Card>
  );
}
