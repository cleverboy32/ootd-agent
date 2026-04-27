import React from 'react';

export function SidebarRight() {
  return (
    <aside className="w-72 border-l border-border p-6 bg-muted/10 hidden lg:block shrink-0">
      <h3 className="font-semibold text-foreground mb-2">历史搭配</h3>
      <p className="text-muted-foreground text-sm">过往的搭配方案将显示在这里</p>
    </aside>
  );
}