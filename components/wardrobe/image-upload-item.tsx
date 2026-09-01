"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useWardrobeStore } from '@/store/wardrobe-store';
import { useTaskQueueStore } from '@/store/task-queue-store';
import { toUserFacingUploadError } from '@/lib/upload-errors';
import { CheckCircle, XCircle, Loader, AlertTriangle, RotateCw } from 'lucide-react';

interface ImageUploadItemProps {
  id: string;
}

export function ImageUploadItem({ id }: ImageUploadItemProps) {
  // --- Core Change: Precise subscription to only this item's data ---
  const fileData = useWardrobeStore(state => state.filesById[id]);
  const removeFile = useWardrobeStore(state => state.removeFile);
  const retryFile = useWardrobeStore(state => state.retryFile);
  const addTask = useTaskQueueStore(state => state.addTask);
  const resetTask = useTaskQueueStore(state => state.resetTask);

  const file = fileData?.file;
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const [brokenPreviewUrl, setBrokenPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (fileData?.status === 'queue') {
      addTask(id, 'upload');
    }
  }, [id, fileData?.status, addTask]);

  if (!fileData) return null;

  const displayError = fileData.error
    ? toUserFacingUploadError(fileData.error)
    : '处理失败，请重试';

  const handleRetry = () => {
    resetTask(id);
    retryFile(id);
    if (fileData.publicUrl) {
      addTask(id, 'analyze');
    } else {
      addTask(id, 'upload');
    }
  };

  const renderOverlay = () => {
    switch (fileData.status) {
      case 'uploading':
      case 'analyzing':
        return (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 text-white p-2 pb-8">
            <Loader className="h-8 w-8 animate-spin" />
            <span className='mt-2 text-xs text-center'>{fileData.status === 'uploading' ? '上传中' : 'AI分析中'}</span>
          </div>
        );
      case 'success':
        return (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-green-500/80">
            <CheckCircle className="h-10 w-10 text-white" />
          </div>
        );
      case 'error':
        return (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-red-800/90 text-white p-3 text-center gap-2">
            <AlertTriangle className="h-6 w-6 shrink-0" />
            <span className='text-xs font-medium leading-snug line-clamp-3'>{displayError}</span>
            <button
              type="button"
              onClick={handleRetry}
              className='mt-1 flex items-center justify-center px-3 py-1.5 text-xs font-medium bg-white/20 hover:bg-white/30 rounded-md'
            >
              <RotateCw className='h-3 w-3 mr-1'/> 重试
            </button>
          </div>
        );
      default: // 'queue'
        return (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 text-white p-2 pb-8">
            <Loader className="h-8 w-8 animate-spin" />
             <span className='mt-2 text-xs text-center'>等待中</span>
          </div>
        );
    }
  };

  return (
    <div className="relative group w-full aspect-square bg-muted rounded-lg overflow-hidden shadow-sm">
        {previewUrl && previewUrl !== brokenPreviewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={fileData.file.name}
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setBrokenPreviewUrl(previewUrl)}
          />
        )}

        {renderOverlay()}

        <button
            onClick={() => removeFile(id)}
            className='absolute top-1 right-1 z-30 p-1.5 bg-black/40 text-white/80 rounded-full opacity-0 group-hover:opacity-100 hover:bg-black/60 hover:text-white transition-opacity'
            aria-label='Remove file'
        >
            <XCircle className='h-4 w-4' />
        </button>

        {fileData.status !== 'error' && (
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-5 bg-black/50 text-white text-xs p-1.5 truncate">
            {fileData.file.name}
          </div>
        )}
    </div>
  );
}

