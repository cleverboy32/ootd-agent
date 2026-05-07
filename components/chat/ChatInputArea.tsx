import React from 'react';
import { Button } from '@/components/ui/button';
import TextareaAutosize from 'react-textarea-autosize';
import { Upload, SendHorizontal, X, Loader2 } from 'lucide-react';

interface ChatInputAreaProps {
  input: string;
  setInput: (value: string) => void;
  selectedImage: File | null;
  resetImageState: () => void;
  previewUrl: string | null;
  isLoading: boolean;
  handleSend: () => void;
  handleImageSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  uploadError: string | null; // 新增：接收上传错误信息
  setUploadError: (error: string | null) => void; // 新增：用于清除错误
}

export function ChatInputArea({ 
  input, 
  setInput, 
  selectedImage,
  previewUrl,
  resetImageState,
  isLoading, 
  handleSend, 
  handleImageSelect, 
  fileInputRef,
  uploadError,      // 新增
  setUploadError    // 新增
}: ChatInputAreaProps) {
  return (
    <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-background via-background/95 to-transparent z-20">
      <div className="max-w-5xl mx-auto">
        {/* 当有上传错误时显示错误信息 */}
        {uploadError && (
          <div className="mb-3 p-3 bg-destructive/10 border border-destructive/30 rounded-xl text-destructive text-sm flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            {uploadError}
          </div>
        )}

        {previewUrl && (
          <div className="mb-3 relative inline-block">
            <div className="p-1 bg-background border border-border rounded-xl shadow-sm">
              <img src={previewUrl} alt="Preview" className="h-20 w-20 object-cover rounded-lg" />
            </div>
            <button
              onClick={resetImageState}
              className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 shadow-sm hover:scale-105 transition-transform"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <div className="relative group">
          <div className="flex items-start bg-background border border-border/20 rounded-3xl p-2 pl-4 shadow-md focus-within:ring-2 focus-within:ring-[var(--gold)]/30 hover:ring-2 hover:ring-[var(--gold)]/20 transition-all">
            <input 
              type="file"
              accept="image/*"
              className="hidden"
              ref={fileInputRef}
              onChange={handleImageSelect}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-muted-foreground hover:text-foreground rounded-full shrink-0"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-5 w-5" />
            </Button>
            <TextareaAutosize
              rows={1}
              maxRows={5}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (uploadError) setUploadError(null); // 用户开始输入时清除错误
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="上传衣服照片，获取搭配建议..."
              className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground py-2 px-3 text-base sm:text-lg resize-none min-h-[40px]"
            />
            <Button
              size="icon"
              onClick={() => handleSend()}
              disabled={isLoading || (!input.trim() && !selectedImage)}
              className="h-10 w-10 bg-gradient-to-br from-amber-400 to-yellow-600 hover:brightness-110 text-black rounded-full shrink-0 ml-2 disabled:opacity-50 transition-all"
            >
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
