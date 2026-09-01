"use client";

import React, { useState } from 'react';
import { MainHeader } from './mainHeader';
import { AddView } from '@/components/wardrobe/add-view';
import { DisplayView } from '@/components/wardrobe/display-view';
import { AppSidebar } from '@/components/AppSidebar';
import { useAccess } from '@/components/access/AccessProvider';


export default function WardrobePage() {
  const { canMutate } = useAccess();
  const [activeView, setActiveView] = useState<'display' | 'add'>('display');
  const switchToDisplay = () => setActiveView('display');
  const visibleView = canMutate ? activeView : 'display';


  return (
    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      <AppSidebar
        activeSection={visibleView === 'display' ? 'wardrobe' : 'add'}
        onWardrobeViewChange={setActiveView}
      />
      <div className="flex flex-col">
        <MainHeader activeView={visibleView} />
        <main className="flex flex-1 flex-col overflow-y-auto">
            {visibleView === 'display' && <div className="p-4 lg:p-6"><DisplayView /></div>}
            {visibleView === 'add' && <AddView onSwitchToDisplay={switchToDisplay} />}
        </main>
      </div>
    </div>
  );
}

