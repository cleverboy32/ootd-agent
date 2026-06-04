import React from 'react';
import ReactMarkdown from 'react-markdown';
import Image from 'next/image';
import remarkGfm from 'remark-gfm';
import { Message } from '@/lib/types';
import { User, AlertTriangle, RefreshCw } from 'lucide-react'; // <-- 引入图标
import { useChatHandler } from '@/hooks/useChatHandler'; // <-- 引入我们的核心 hook
import { Button } from '@/components/ui/button'; // <-- 引入按钮
import { WardrobeItem } from './WardrobeItem'; // <-- 1. 导入新组件

// 2. 定义辅助函数
const ContentRenderer = ({ text }: { text: string }) => {
  const regex = /\[衣橱物品:id=([^\]]+)\]/g;
  const parts = text.split(regex);

  // [NEW] Define a custom renderer for markdown images to control their style
  const markdownComponents = {
    img: (props: React.ComponentPropsWithoutRef<'img'>) => {
      const src = props.src;
      if (!src || typeof src !== 'string') return null;
      return (
        <Image
          src={src}
          alt={props.alt || 'AI generated image'}
                        width={200}
                        height={200}
                        unoptimized
                        className="h-auto w-full max-w-[200px] rounded-xl my-3 border border-border/10"
                      />
                    );
    },
  };

  // If there are no special tags, just render the markdown directly.
  if (parts.length <= 1) {
    // [MODIFIED] Pass our custom components to ReactMarkdown to handle images
    return <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{text}</ReactMarkdown>;
  }
  return (
    <>
      {parts.map((part, i) => {
        // Odd-indexed parts are the captured wardrobe item IDs
        if (i % 2 === 1) {
          const itemId = part;
          return (
            <span key={`item-${itemId}-${i}`} className="inline-block align-middle mx-1">
              <WardrobeItem itemId={itemId} />
            </span>
                    );
                  }

        // Even-indexed parts are the regular text.
        // We render them through ReactMarkdown but disable the default <p> tag's margin
        // to ensure they flow inline with our custom components.
        if (part) {
          return (
            <ReactMarkdown
              key={`text-${i}`}
              remarkPlugins={[remarkGfm]}
              components={{
                // Keep the existing custom component for inline paragraphs
                p: ({ children }: React.ComponentPropsWithoutRef<'p'>) => <span className="inline">{children}</span>,
                // [MODIFIED] Add our custom image renderer to this part as well
                ...markdownComponents
              }}
            >
              {part}
            </ReactMarkdown>
          );
        }
        return null;
      })}
    </>
  );
};


// 1. 更新 props 接口以接收 isLoading
interface ChatMessageProps {
  msg: Message;
  isLoading?: boolean;
}
export function ChatMessage({ msg, isLoading = false }: ChatMessageProps) {

  const { handleSend } = useChatHandler(); 

  // 2. 决定是否应该渲染气泡的条件
  const shouldRenderBubble = (
    (Array.isArray(msg.content) && msg.content.length > 0) || // AI消息有内容
    (typeof msg.content === 'string' && msg.content !== '') || // 用户消息有内容
    msg.imageUrl // 用户上传了图片
  );

  const isGenerating = msg.role === 'ai' && msg.status === 'generating' && msg.content.length === 0;

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
              {Array.isArray(msg.content) ? (
                msg.content.map((part, index) => {
                  if (part.type === 'text') {
                    return <ContentRenderer key={part.id || index} text={part.content} />;
                  } else if (part.type === 'image') {
                    return (
                      <Image
                        key={part.id || index}
                        src={part.content}
                        alt={part.alt || 'Generated image'}
                        width={200}
                        height={200}
                        unoptimized
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
                  <ContentRenderer text={msg.content as string} />
                ) : (
                  msg.content
                )
              )}
            </div>
          )}

          {isGenerating && !shouldRenderBubble && (
            <div className="rounded-2xl px-5 py-3.5 bg-muted/40 border border-border/50 rounded-tl-sm shadow-sm">
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 animate-pulse"></span>
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 animate-pulse delay-150"></span>
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 animate-pulse delay-300"></span>
                </div>
            </div>
          )}

          {msg.role === 'ai' && msg.status === 'failed' && (
            <div className="flex items-center gap-2 mt-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-xs">消息生成失败</span>
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center gap-1.5 text-xs h-auto px-2 py-1"
                onClick={() => handleSend(msg)} // <-- 核心！点击时调用重试逻辑
              >
                <RefreshCw className="h-3 w-3" />
                重试
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

