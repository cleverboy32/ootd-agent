import React, { useEffect } from 'react';
import Image from 'next/image';
import { ChatMessage } from './ChatMessage';
import { useChatStore } from '@/store/chat';
interface ChatMessagesListProps {
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

export function ChatMessagesList({ messagesEndRef }: ChatMessagesListProps) {

  const {
    messages,
    isLoading,
  } = useChatStore();

  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    console.log(isLoading, messages);
  }, [isLoading, messages])

  // New: Show a loading state for the entire chat history
  // This triggers when isLoading is true but there are no messages to display yet.
  if (isLoading) {
    return (
      <div className="flex-1 flex h-full items-center justify-center text-muted-foreground">
        <div className="flex items-center gap-3 animate-pulse">
          <Image src="/logo.png" alt="Loading..." width={24} height={24} className='animate-spin' />
          <span>正在加载历史消息...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-8 px-6 sm:px-12 flex flex-col gap-6">
      {messages.map((msg, idx) => (
        <ChatMessage
          key={idx}
          msg={msg}
        />
      ))}

      {/* Existing: "AI is typing" indicator */}
      {isLoading && lastMessage?.role === 'user' && (
        <div className="flex justify-start">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Image src="/logo.png" alt="Fashion AI Logo" width={48} height={48} className='animate-spin' />
            </div>
            {/* 在旋转头像旁边，添加一个空的、样式化的气泡 */}
            <div className="flex flex-col gap-1 items-start">
              <div className="rounded-2xl px-5 py-3.5 bg-muted/40 border border-border/50 rounded-tl-sm shadow-sm">
                {/* 这是一个“假”的加载动画，模仿打字效果 */}
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 animate-pulse"></span>
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 animate-pulse delay-150"></span>
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 animate-pulse delay-300"></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}
