import React from 'react';
import ReactMarkdown from 'react-markdown';
import Image from 'next/image';
import remarkGfm from 'remark-gfm';
import { User } from 'lucide-react';
import { Message } from '@/lib/types';

// 1. 更新 props 接口以接收 isLoading
interface ChatMessageProps {
  msg: Message;
  isLoading?: boolean;
}
export function ChatMessage({ msg, isLoading = false }: ChatMessageProps) {
  // 2. 决定是否应该渲染气泡的条件
  const shouldRenderBubble = (
    (Array.isArray(msg.content) && msg.content.length > 0) || // AI消息有内容
    (typeof msg.content === 'string' && msg.content.trim() !== '') || // 用户消息有内容
    msg.imageUrl // 用户上传了图片
  );

  return (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex items-start gap-3 max-w-[95%] sm:max-w-[90%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
        <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-pink-300 text-white' : 'bg-primary/10 text-primary'}`}>
          {msg.role === 'user' ? (
            <User className="h-5 w-5" />
          ) : (
            // 3. 如果是 AI 消息且正在加载，让图标旋转
            <Image src="/logo.png" alt="Fashion AI Logo" width={48} height={48} className={`rounded-full ${isLoading ? 'animate-spin' : ''}`} />
          )}
        </div>
        <div className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
          {/* 4. 使用上面计算出的条件来决定是否渲染气泡 */}
          {shouldRenderBubble && (
            <div className={`rounded-2xl px-5 py-3.5 ${msg.role === 'user' ? 'bg-gradient-to-br from-amber-400/20 to-yellow-600/10 text-black rounded-tr-sm' : 'bg-muted/40 border border-border/50 text-foreground rounded-tl-sm'} shadow-sm ${msg.role === 'ai' ? 'prose prose-sm dark:prose-invert max-w-none' : 'whitespace-pre-wrap leading-relaxed'}`}>
              {msg.imageUrl && (
                <Image src={msg.imageUrl} alt="Uploaded" width={200} height={200} className="max-w-[200px] sm:max-w-xs h-auto rounded-xl mb-3 border border-border/10" />
              )}

              {Array.isArray(msg.content) ? (
                msg.content.map((part, index) => {
                  if (part.type === 'text') {
                    return <ReactMarkdown key={part.id || index} remarkPlugins={[remarkGfm]}>{part.content}</ReactMarkdown>;
                  } else if (part.type === 'image') {
                    return (
                      <Image
                        key={part.id || index}
                        src={part.content}
                        alt={part.alt || 'Generated image'}
                        width={200}
                        height={200}
                        className="h-auto w-full max-w-[200px] rounded-xl my-3 border border-border/10"
                      />
                    );
                  } else if (part.type === 'image_placeholder') {
                    return (
                      <div key={part.id || index} className="h-[200px] w-full max-w-[200px] rounded-xl my-3 border border-border/10 bg-muted/40 flex flex-col items-center justify-center text-center p-2">
                        <div className="h-8 w-8 border-4 border-dashed rounded-full border-muted-foreground/30 border-t-transparent animate-spin mb-2"></div>
                        <p className="text-xs text-muted-foreground">正在生成图片：</p>
                        <p className="text-xs text-muted-foreground truncate w-full">{part.content}</p>
                      </div>
                    );
                  } else if (part.type === 'image_failed') {
                    return (
                      <div key={part.id || index} className="h-[200px] w-full max-w-[200px] rounded-xl my-3 border border-destructive/50 bg-destructive/10 flex flex-col items-center justify-center text-center p-3">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-destructive mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <p className="text-xs font-semibold text-destructive">图片生成失败</p>
                        <p className="text-xs text-destructive/80 mt-1 line-clamp-3" title={part.content}>{part.content}</p>
                      </div>
                    );
                  }
                  return null;
                })
              ) : (
                msg.role === 'ai' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                ) : (
                  msg.content
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

