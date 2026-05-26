"use client";

import React, { useEffect } from 'react';
import { BatchUploader } from '@/components/wardrobe/batch-uploader';
import { Button } from '@/components/ui/button';
import { useWardrobeStore } from '@/store/wardrobe-store';
import { ImageUploadItem } from './image-upload-item';
import { useShallow } from 'zustand/react/shallow';

interface AddViewProps {
    onSwitchToDisplay: () => void;
}

export function AddView({ onSwitchToDisplay }: AddViewProps) {
  const { fileIds, filesById, reset, clearSuccessful } = useWardrobeStore(
    useShallow((state) => ({
      fileIds: state.fileIds,
      filesById: state.filesById,
      reset: state.reset,
      clearSuccessful: state.clearSuccessful,
    }))
  );

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      return () => {
        reset();
      };
    }
  }, [reset]);

  const handleContinue = () => {
    clearSuccessful();
  };

  const allFiles = Object.values(filesById);
  const allDone = allFiles.length > 0 && allFiles.every(f => f.status === 'success' || f.status === 'error');

  return (
    <div className='p-4 lg:p-6 w-full space-y-6'>
      <BatchUploader />

      {fileIds.length > 0 && (
        <div className="space-y-4">
            <div className='flex justify-between items-center'>
                <h3 className="text-lg font-semibold">
                  {allDone ? `处理完成 (${fileIds.length} 张图片)` : `正在处理 ${fileIds.length} 张图片...`}
                </h3>
                {allDone ? (
                  <div className='flex gap-4'>
                      <Button onClick={onSwitchToDisplay}>查看我的衣橱</Button>
                      <Button variant="outline" onClick={handleContinue}>清除成功项</Button>
                  </div>
                ) : (
                  <Button variant="destructive" onClick={reset}>全部取消</Button>
                )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {fileIds.map(fileId => (
                    <ImageUploadItem key={fileId} id={fileId} />
                ))}
            </div>
        </div>
      )}
    </div>
  );
}