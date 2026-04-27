import React from 'react';
import { Loader2 } from 'lucide-react';
import { Message } from '@/app/page';
import { ChatMessage } from './ChatMessage';

interface ChatMessagesListProps {
  messages: Message[];
  isLoading: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

export function ChatMessagesList({ messages, isLoading, messagesEndRef }: ChatMessagesListProps) {
  return (
    <div className="pt-8 px-6 sm:px-12 flex flex-col gap-6">
      {messages.map((msg, idx) => (
        <ChatMessage key={idx} msg={msg} />
      ))}
      {isLoading && (
        <div className="flex justify-start">
          <div className="flex items-start gap-6 max-w-[90%]">
            <div className="rounded-2xl px-5 py-3.5 bg-muted/40 border border-border/50 text-foreground rounded-tl-sm flex items-center gap-3 shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">正在构思搭配方案...</span>
            </div>
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}