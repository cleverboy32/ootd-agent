import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { User, Sparkles } from 'lucide-react';
// 1. 修正导入路径，使用我们中心化的类型
import { Message } from '@/lib/types';

export function ChatMessage({ msg }: { msg: Message }) {
  return (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex items-start gap-3 w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
        <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-indigo-500 text-white' : 'bg-primary/10 text-primary'}`}>
          {msg.role === 'user' ? <User className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        </div>
        <div className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
          <div className={`rounded-2xl px-5 py-3.5 ${msg.role === 'user' ? 'bg-indigo-500 text-white rounded-tr-sm' : 'bg-muted/40 border border-border/50 text-foreground rounded-tl-sm'} shadow-sm ${msg.role === 'ai' ? 'prose prose-sm dark:prose-invert max-w-none' : 'whitespace-pre-wrap leading-relaxed'}`}>
            {msg.imageUrl && (
              <img src={msg.imageUrl} alt="Uploaded" className="max-w-[200px] sm:max-w-xs rounded-xl mb-3 border border-border/10" />
            )}
            
            {/* 2. -- 新的渲染逻辑 -- */}
            {Array.isArray(msg.content) ? (
              // 如果 content 是数组，则进行图文混排
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
              // 否则，保持旧的纯文本渲染逻辑
              msg.role === 'ai' ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              ) : (
                msg.content
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

