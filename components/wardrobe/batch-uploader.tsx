

"use client";

import React, { ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Upload } from 'lucide-react';
import { useWardrobeStore } from '@/store/wardrobe-store';

export function BatchUploader() {
  const addFiles = useWardrobeStore((state) => state.addFiles);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const files = Array.from(event.target.files);
      if (files.length > 0) {
        addFiles(files);
      }
    }
    // Reset the input value to allow selecting the same file(s) again
    event.target.value = '';
  };

  return (
    <div className='flex items-center gap-6 p-6 border rounded-lg bg-card text-card-foreground shadow-sm'>
        <Button size="lg" onClick={() => document.getElementById('file-upload-batch')?.click()}>
            <Upload className="mr-2 h-5 w-5" />
            选择图片
        </Button>
        <div className='space-y-1'>
            <h3 className="text-lg font-semibold">批量添加衣物</h3>
            <p className="text-sm text-muted-foreground">选择多张图片后将自动开始上传和分析。</p>
        </div>
        <Input id="file-upload-batch" type="file" accept="image/*" onChange={handleFileChange} multiple className="sr-only" />
    </div>
  );
}
 