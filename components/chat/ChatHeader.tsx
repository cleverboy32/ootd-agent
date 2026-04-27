import React from 'react';

export function ChatHeader() {
  return (
    <header className="h-14 flex items-center justify-between px-6 bg-background/80 backdrop-blur-sm sticky top-0 z-10 border-b border-border/40">
      <h2 className="font-semibold text-foreground">AI 时尚搭配助手</h2>
    </header>
  );
}