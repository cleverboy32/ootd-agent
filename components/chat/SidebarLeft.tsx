import Image from "next/image";
import { Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import React from "react";
import { Conversation } from "@/lib/types"; // 1. 导入 Conversation 类型

// 2. 更新 Props 接口
interface SidebarLeftProps {
  onNewChat: () => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  setActiveConversationId: (id: string) => void;
}

export function SidebarLeft({ 
  onNewChat,
  conversations,
  activeConversationId,
  setActiveConversationId
}: SidebarLeftProps) {
  return (
    <aside className="w-72 flex flex-col bg-muted/30 border-r border-border shrink-0">
      {/* --- 顶部 Logo 和标题 (无变化) --- */}
      <div className="p-4 flex items-center gap-3">
        <Image src="/logo.png" alt="Fashion AI Logo" width={32} height={32} className="rounded-md" />
        <span className="font-semibold text-lg tracking-tight">Fashion AI</span>
      </div>

      {/* --- 搜索框 (无变化) --- */}
      <div className="px-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索对话"
            className="pl-9 h-10 rounded-xl bg-background border-border shadow-sm"
          />
        </div>
      </div>

      {/* --- 新建对话按钮 (无变化) --- */}
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

      {/* --- 3. 会话历史记录列表 --- */}
      <div className="flex-1 overflow-y-auto px-4">
        <div className="flex flex-col gap-2">
          {conversations.length > 0 ? (
            conversations.map((convo) => (
              <Button
                key={convo.id}
                variant="ghost"
                onClick={() => setActiveConversationId(convo.id)}
                className={`w-full justify-start truncate px-3 py-5 text-sm h-auto transition-colors
                  ${activeConversationId === convo.id 
                    ? 'bg-accent text-accent-foreground' // 激活状态的样式
                    : 'hover:bg-accent/50'               // 未激活状态的样式
                  }`
                }
              >
                {convo.title}
              </Button>
            ))
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground text-sm">
              <p>还没有历史记录</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}