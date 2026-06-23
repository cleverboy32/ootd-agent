import React from 'react';
import Link from 'next/link';
import { Shirt, UserCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ChatHeader() {
  return (
    <header className="h-14 flex items-center justify-between px-6 bg-background/80 backdrop-blur-sm sticky top-0 z-10 border-b border-border/40">
      <h2 className="font-semibold text-foreground">AI 时尚搭配助手</h2>

      <div className="flex items-center gap-1">
        <Link href="/profile" passHref>
          <Button variant="ghost" className="flex items-center gap-2">
            <UserCircle className="h-5 w-5" />
            <span className="hidden sm:inline">我的档案</span>
          </Button>
        </Link>
        <Link href="/wardrobe" passHref>
          <Button variant="ghost" className="flex items-center gap-2">
            <Shirt className="h-5 w-5" />
            <span className="hidden sm:inline">我的衣橱</span>
          </Button>
        </Link>
      </div>
    </header>
  );
}