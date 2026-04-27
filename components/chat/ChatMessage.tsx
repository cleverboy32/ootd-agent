import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { User, Sparkles } from 'lucide-react';
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
        <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-indigo-500 text-white' : 'bg-primary/10 text-primary'}`}>
          {msg.role === 'user' ? (
            <User className="h-5 w-5" />
          ) : (
            // 3. 如果是 AI 消息且正在加载，让图标旋转
            <Sparkles className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} />
          )}
        </div>
        <div className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
          {/* 4. 使用上面计算出的条件来决定是否渲染气泡 */}
          {shouldRenderBubble && (
            <div className={`rounded-2xl px-5 py-3.5 ${msg.role === 'user' ? 'bg-indigo-500 text-white rounded-tr-sm' : 'bg-muted/40 border border-border/50 text-foreground rounded-tl-sm'} shadow-sm ${msg.role === 'ai' ? 'prose prose-sm dark:prose-invert max-w-none' : 'whitespace-pre-wrap leading-relaxed'}`}>
              {msg.imageUrl && (
                <img src={msg.imageUrl} alt="Uploaded" className="max-w-[200px] sm:max-w-xs rounded-xl mb-3 border border-border/10" />
              )}

              {Array.isArray(msg.content) ? (
                msg.content.map((part, index) => {
                  if (part.type === 'text') {
                    return <ReactMarkdown key={index} remarkPlugins={[remarkGfm]}>{part.content}</ReactMarkdown>;
                  } else if (part.type === 'image') {
                    return (
                      <img
                        key={index}
                        src={part.content}
                        alt={part.alt || 'Generated image'}
                        className="max-w-full rounded-xl my-3 border border-border/10"
                      />
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

