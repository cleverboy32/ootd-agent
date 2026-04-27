import Image from "next/image";
import { Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import React from "react";

interface SidebarLeftProps {
  onNewChat: () => void;
}

export function SidebarLeft({ onNewChat }: SidebarLeftProps) {
  return (
    <aside className="w-72 flex flex-col bg-muted/30 border-r border-border shrink-0">
      <div className="p-4 flex items-center gap-3">
        <Image src="/logo.png" alt="Fashion AI Logo" width={32} height={32} className="rounded-md" />
        <span className="font-semibold text-lg tracking-tight">Fashion AI</span>
      </div>

      <div className="px-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索对话"
            className="pl-9 h-10 rounded-xl bg-background border-border shadow-sm"
          />
        </div>
      </div>

      <div className="px-4 mb-6">
        <Button
          variant="outline"
          onClick={onNewChat}
          className="w-full justify-start gap-3 rounded-full py-6 px-4 shadow-sm hover:bg-accent group border-border"
        >
          <div className="bg-primary/10 p-1.5 rounded-full group-hover:bg-primary/20 transition-colors">
            <Plus className="h-4 w-4 text-primary" />
          </div>
          <span className="font-medium text-sm">新建对话</span>
        </Button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground text-sm">
        <p>还没有历史记录</p>
      </div>
    </aside>
  );
}