"use client";

import React, { useEffect, useMemo } from 'react';
import Image from 'next/image';
import { useWardrobeStore } from '@/store/wardrobe-store';
import { useTaskQueueStore } from '@/store/task-queue-store';
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

  // Use useMemo for stable preview URL creation, avoiding setState in effect
  const previewUrl = useMemo(() => {
    if (fileData?.file) {
      return URL.createObjectURL(fileData.file);
    }
    return '';
  }, [fileData.file]);

  useEffect(() => {
    if (fileData?.status === 'queue') {
      // Only add to queue if it's in the initial state.
      // This check is crucial to prevent re-adding on every render.
      addTask(id, 'upload');
    }

    // Cleanup the object URL when the component unmounts or URL changes
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [id, fileData?.status, addTask, previewUrl]);
  if (!fileData) return null;

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
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-white p-2">
            <Loader className="h-8 w-8 animate-spin" />
            <span className='mt-2 text-xs text-center'>{fileData.status === 'uploading' ? '上传中' : 'AI分析中'}</span>
          </div>
        );
      case 'success':
        return (
          <div className="absolute inset-0 flex items-center justify-center bg-green-500/80">
            <CheckCircle className="h-10 w-10 text-white" />
          </div>
        );
      case 'error':
        return (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-800/90 text-white p-2 text-center space-y-2">
            <AlertTriangle className="h-6 w-6" />
            <span className='text-xs font-semibold'>{fileData.error}</span>
            <button
              onClick={handleRetry}
              className='flex items-center justify-center px-2 py-1 text-xs bg-white/20 hover:bg-white/30 rounded-md'
            >
                <RotateCw className='h-3 w-3 mr-1'/> 重试
            </button>
          </div>
        );
      default: // 'queue'
        return (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-white p-2">
            <Loader className="h-8 w-8 animate-spin" />
             <span className='mt-2 text-xs text-center'>等待中</span>
          </div>
        );
    }
  };

  return (
    <div className="relative group w-full aspect-square bg-muted rounded-lg overflow-hidden shadow-sm">
        {previewUrl && (
            <Image
                src={previewUrl}
                alt={fileData.file.name}
                fill
                className="object-cover"
            />
        )}

        {renderOverlay()}

        <button
            onClick={() => removeFile(id)}
            className='absolute top-1 right-1 p-1.5 bg-black/40 text-white/80 rounded-full opacity-0 group-hover:opacity-100 hover:bg-black/60 hover:text-white transition-opacity'
            aria-label='Remove file'
        >
            <XCircle className='h-4 w-4' />
        </button>

        <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1.5 truncate">
            {fileData.file.name}
        </div>
    </div>
  );
}

