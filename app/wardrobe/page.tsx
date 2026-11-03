"use client";

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MainHeader } from './mainHeader';
import { AddView } from '@/components/wardrobe/add-view';
import { DisplayView } from '@/components/wardrobe/display-view';
import { AppSidebar } from '@/components/AppSidebar';
import { WardrobeGuideBubble } from '@/components/onboarding/WardrobeGuideBubble';
import { useAccess } from '@/components/access/AccessProvider';

function WardrobePageInner() {
  const { canMutate } = useAccess();
  const searchParams = useSearchParams();
  const [activeView, setActiveView] = useState<'display' | 'add'>(() =>
    searchParams.get('add') === '1' ? 'add' : 'display'
  );
  const switchToDisplay = () => setActiveView('display');
  const switchToAdd = () => setActiveView('add');
  const visibleView = canMutate ? activeView : 'display';

  return (
    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      <AppSidebar
        activeSection="wardrobe"
        onSelectWardrobe={switchToDisplay}
      />
      <div className="relative flex flex-col">
        <MainHeader activeView={visibleView} onBackToDisplay={switchToDisplay} />
        <main className="flex flex-1 flex-col overflow-y-auto">
          {visibleView === 'display' && (
            <div className="p-4 lg:p-6">
              <DisplayView onAddItems={switchToAdd} />
            </div>
          )}
          {visibleView === 'add' && <AddView onSwitchToDisplay={switchToDisplay} />}
        </main>
        {canMutate && <WardrobeGuideBubble onAddItems={switchToAdd} />}
      </div>
    </div>
  );
}

export default function WardrobePage() {
  return (
    <Suspense fallback={null}>
      <WardrobePageInner />
    </Suspense>
  );
}
