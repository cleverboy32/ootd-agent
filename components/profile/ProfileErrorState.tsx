"use client";

import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ProfileErrorStateProps {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
}

export function ProfileErrorState({
  message,
  onRetry,
  retryLabel = '重试',
  retrying = false,
}: ProfileErrorStateProps) {
  return (
    <div className="flex w-full flex-col items-center gap-4 rounded-xl border border-destructive/20 bg-destructive/5 px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircle className="h-6 w-6 text-destructive" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">出了点问题</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={`mr-2 h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
          {retrying ? '正在重试…' : retryLabel}
        </Button>
      )}
    </div>
  );
}
