"use client";

import React, { useState } from 'react';
import { useWardrobeStore } from '@/store/wardrobe-store';
import { Button } from '@/components/ui/button';
import { AddView } from '@/components/wardrobe/add-view';
import { PlayCircle } from 'lucide-react';

/**
 * A development-only component to test the batch upload functionality under load.
 */
export function UploadTester() {
  const addFiles = useWardrobeStore((state) => state.addFiles);
  const [isTestRunning, setIsTestRunning] = useState(false);

  const handleStartTest = () => {
    console.log('--- STARTING 20-ITEM UPLOAD TEST ---');
    setIsTestRunning(true);

    const fakeFiles: File[] = [];
    for (let i = 1; i <= 20; i++) {
      // Create a dummy file. The content doesn't matter for the upload API,
      // but the name and type are useful for UI.
      const fileName = `test_image_${i}.png`;
      const file = new File(['dummy-content'], fileName, { type: 'image/png' });
      fakeFiles.push(file);
    }

    // Add all 20 files to the store at once to trigger the queue.
    addFiles(fakeFiles);
  };

  return (
    <div className="container mx-auto p-4 space-y-8">
      <div className="p-6 border-2 border-dashed rounded-lg bg-card">
        <h2 className="text-xl font-bold mb-4">上传压力测试工具</h2>
        <p className="text-muted-foreground mb-4">
          点击下面的按钮来模拟一次性选择 20 张图片。这将启动批量上传和分析流程，让我们可以观察任务队列在高负载下的表现。
        </p>
        <Button onClick={handleStartTest} disabled={isTestRunning}>
          <PlayCircle className="mr-2 h-4 w-4" />
          开始 20 个文件的上传测试
        </Button>
      </div>

      {/* Render the actual AddView component to display the results */}
      <div className="mt-8">
         <AddView onSwitchToDisplay={() => console.log('--- TEST VIEW: Switch to Display triggered ---')} />
      </div>
    </div>
  );
}
