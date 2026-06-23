"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { LayoutDashboard, PlusSquare, UserCircle } from 'lucide-react';
import { MainHeader } from './mainHeader';
import { AddView } from '@/components/wardrobe/add-view';
import { DisplayView } from '@/components/wardrobe/display-view';


export default function WardrobePage() {
  const [activeView, setActiveView] = useState<'display' | 'add'>('display');
  const switchToDisplay = () => setActiveView('display');


  return (
    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      <div className="hidden border-r bg-muted/40 md:block">
        <div className="flex h-full max-h-screen flex-col gap-2">
          <div className="flex h-14 items-center px-4 lg:h-[60px] lg:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <Image src="/logo.png" alt="Fashion AI Logo" width={28} height={28} className="rounded-md" />
              <span className="font-semibold text-lg tracking-tight">Fashion AI</span>
            </Link>
          </div>
          <div className="flex-1">
            <nav className="grid items-start gap-1 px-2 text-sm font-medium lg:px-4">
              <button
                onClick={() => setActiveView('display')}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary ${
                  activeView === 'display' ? 'bg-muted text-primary' : ''
                }`}
              >
                <LayoutDashboard className="h-4 w-4" />
                衣橱总览
              </button>
              <button
                onClick={() => setActiveView('add')}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary ${
                  activeView === 'add' ? 'bg-muted text-primary' : ''
                }`}
              >
                <PlusSquare className="h-4 w-4" />
                添加衣物
              </button>
              <Link
                href="/profile"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary"
              >
                <UserCircle className="h-4 w-4" />
                我的档案
              </Link>
            </nav>
          </div>
        </div>
      </div>
      <div className="flex flex-col">
        <MainHeader activeView={activeView} />
        <main className="flex flex-1 flex-col overflow-y-auto">
            {activeView === 'display' && <div className="p-4 lg:p-6"><DisplayView /></div>}
            {activeView === 'add' && <AddView onSwitchToDisplay={switchToDisplay} />}
        </main>
      </div>
    </div>
  );
}

