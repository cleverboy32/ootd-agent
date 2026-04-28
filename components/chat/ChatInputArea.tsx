import React from 'react';
import { Button } from '@/components/ui/button';
import TextareaAutosize from 'react-textarea-autosize';
import { Upload, SendHorizontal, X, Loader2 } from 'lucide-react';

interface ChatInputAreaProps {
  input: string;
  setInput: (value: string) => void;
  selectedImage: File | null;
  setSelectedImage: (file: File | null) => void;
  previewUrl: string | null;
  setPreviewUrl: (url: string | null) => void;
  isLoading: boolean;
  handleSend: () => void;
  handleImageSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
}

export function ChatInputArea({ 
  input, 
  setInput, 
  selectedImage,
  setSelectedImage,
  previewUrl,
  setPreviewUrl,
  isLoading, 
  handleSend, 
  handleImageSelect, 
  fileInputRef 
}: ChatInputAreaProps) {
  return (
    <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-background via-background/95 to-transparent z-20">
      <div className="max-w-5xl mx-auto">
        {previewUrl && (
          <div className="mb-3 relative inline-block">
            <div className="p-1 bg-background border border-border rounded-xl shadow-sm">
              <img src={previewUrl} alt="Preview" className="h-20 w-20 object-cover rounded-lg" />
            </div>
            <button
              onClick={() => { setSelectedImage(null); setPreviewUrl(null); }}
              className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 shadow-sm hover:scale-105 transition-transform"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <div className="relative group">
          <div className="flex items-start bg-background border border-border/20 rounded-3xl p-2 pl-4 shadow-md focus-within:ring-2 focus-within:ring-indigo-500/50 hover:ring-2 hover:ring-[var(--gold)]/30 transition-all">
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
              onChange={(e) => setInput(e.target.value)}
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
              className="h-10 w-10 bg-indigo-500 hover:bg-indigo-600 text-white rounded-full shrink-0 ml-2 disabled:opacity-50"
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