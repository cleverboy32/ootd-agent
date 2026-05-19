import React, { useRef } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import TextareaAutosize from 'react-textarea-autosize';
import { Upload, SendHorizontal, X, Loader2 } from 'lucide-react';
import { useImageHandler } from '@/hooks/useImageHandler'; // 1. 导入我们重构好的 hook

// 2. 大大简化 props，父组件不再需要管理任何图片状态
interface ChatInputAreaProps {
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean; // 这个 isLoading 是指消息发送中
  handleSend: (message: string, imageUrl?: string) => void; // 3. 更新 handleSend 的函数签名
}

export function ChatInputArea({ 
  input, 
  setInput, 
  isLoading, 
  handleSend, 
}: ChatInputAreaProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // 4. 在组件内部直接使用 useImageHandler 来管理所有图片相关的状态和逻辑
  const {
    previewUrl,
    isUploading, // 新增：获取上传状态
    uploadError,
    uploadedImageUrl, // 新增：获取上传成功后的最终 URL
    handleFileSelect,
    resetImageState,
  } = useImageHandler();

  // 5. 封装发送逻辑
  const onSend = () => {
    // 如果图片正在上传但还没上传完 (uploadedImageUrl 还不存在)，则阻止发送
    if (previewUrl && !uploadedImageUrl) {
        console.log("图片正在上传，请稍候...");
        return;
    };

    // 调用从父组件传入的 handleSend，并传递最终的图片 URL
    handleSend(input, uploadedImageUrl || undefined);

    // 发送后清空输入框和图片状态
    setInput('');
    resetImageState();
    if(fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // 同样，在上传时按回车也不发送
      if (!isUploading) {
        onSend();
      }
    }
  };

  // 6. 决定“发送”按钮是否应该被禁用
  // 正在发送消息(isLoading) 或 正在上传图片(isUploading) 或 (没有文字且没有上传成功的图片) 时，禁用按钮
  const isSendDisabled = isLoading || isUploading || (!input.trim() && !uploadedImageUrl);

  return (
    <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-background via-background/95 to-transparent z-20">
      <div className="max-w-5xl mx-auto">
        {/* 直接使用 hook 中的 uploadError 显示错误 */}
        {uploadError && (
          <div className="mb-3 p-3 bg-destructive/10 border border-destructive/30 rounded-xl text-destructive text-sm flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            {uploadError}
          </div>
        )}

        {/* 7. 根据 isUploading 状态显示加载动画 */}
        {previewUrl && (
          <div className="mb-3 relative inline-block">
            <div className="relative p-1 bg-background border border-border rounded-xl shadow-sm">
              <Image src={previewUrl} alt="Preview" width={80} height={80} className="h-20 w-20 object-cover rounded-lg" />
              {isUploading && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg">
                  <Loader2 className="h-6 w-6 text-white animate-spin" />
                </div>
              )}
            </div>
            {/* 只有在非上传状态下才显示移除按钮 */}
            {!isUploading && (
              <button
                onClick={() => {
                  resetImageState();
                   if(fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                }}
                className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 shadow-sm hover:scale-105 transition-transform"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        <div className="relative group">
          <div className="flex items-start bg-background border border-border/20 rounded-3xl p-2 pl-4 shadow-md focus-within:ring-2 focus-within:ring-[var(--gold)]/30 hover:ring-2 hover:ring-[var(--gold)]/20 transition-all">
            <input 
              type="file"
              accept="image/*"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileSelect} // 直接连接到 hook 的处理器
              disabled={isUploading} // 上传时禁用文件选择
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-muted-foreground hover:text-foreground rounded-full shrink-0"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading} // 上传时禁用
            >
              <Upload className="h-5 w-5" />
            </Button>
            <TextareaAutosize
              rows={1}
              maxRows={5}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown} // 使用封装后的 onKeyDown
              placeholder="上传衣服照片，获取搭配建议..."
              className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground py-2 px-3 text-base sm:text-lg resize-none min-h-[40px]"
            />
            <Button
              size="icon"
              onClick={onSend} // 使用封装后的 onSend
              disabled={isSendDisabled} // 使用计算出的禁用状态
              className="h-10 w-10 bg-gradient-to-br from-amber-400 to-yellow-600 hover:brightness-110 text-black rounded-full shrink-0 ml-2 disabled:opacity-50 transition-all"
            >
              {/* 优先显示消息发送的 loading，其次才是默认的发送图标 */}
              {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
            </Button>
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground mt-4">
          Fashion AI 会根据提供的图片和描述生成搭配建议，结果仅供参考。
        </p>
      </div>
    </div>
  );
}