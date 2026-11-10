"use client";

import Image from "next/image";
import { Search, Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import React from "react";
import { useChatStore } from "@/store/chat";
import { useAccess } from "@/components/access/AccessProvider";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { LOGO_SRC } from "@/lib/utils";

interface SidebarLeftProps {
  onNewChat: () => void;
}

export function SidebarLeft({ 
  onNewChat,
}: SidebarLeftProps) {
  const { ready: accessReady, authenticated, canMutate } = useAccess();
  const { openAuthModal } = useAuthModal();
  const {
    conversations,
    activeConversationId,
    setActiveConversationId,
    deleteConversation,
    isLoading,
    deletingConversationId,
  } = useChatStore();
  const showGuestEmpty = accessReady && !authenticated;
  const isDeleting = Boolean(deletingConversationId);

  const handleDelete = (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation();
    if (isDeleting) return;
    void deleteConversation(conversationId);
  };

  return (
    <aside className="w-72 flex flex-col bg-muted/30 border-r border-border shrink-0">
      {/* --- Top Logo and Title (unchanged) --- */}
      <div className="p-4 flex items-center gap-3">
        <Image src={LOGO_SRC} alt="Fashion AI Logo" width={32} height={32} className="rounded-md" />
        <span className="font-semibold text-lg tracking-tight">Fashion AI</span>
      </div>

      {/* --- Search Box (unchanged) --- */}
      <div className="px-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索对话"
            disabled={showGuestEmpty}
            className="pl-9 h-10 rounded-xl bg-background border-border shadow-sm transition-colors hover:border-[var(--gold)] focus-visible:border-[var(--gold)] focus-visible:ring-[var(--gold)]/30 disabled:opacity-60"
          />
        </div>
      </div>

      {/* --- New Chat Button：未登录隐藏 --- */}
      {canMutate && (
        <div className="px-4 mb-6">
          <Button
            variant="outline"
            onClick={onNewChat}
            className="w-full justify-start gap-3 rounded-full py-6 px-4 shadow-sm group border-border transition-colors hover:border-[var(--gold)] hover:bg-accent"
          >
            <div className="bg-primary/10 p-1.5 rounded-full group-hover:bg-[var(--gold)]/15 transition-colors">
              <Plus className="h-4 w-4 text-primary group-hover:text-[var(--gold)] transition-colors" />
            </div>
            <span className="font-medium text-sm">新建对话</span>
          </Button>
        </div>
      )}

      {/* --- Conversation History List --- */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-4">
        <div className="flex flex-col gap-2">
          {showGuestEmpty ? (
            <div className="flex flex-col items-start gap-3 pt-6 text-sm text-muted-foreground">
              <p>登录后同步你的对话历史</p>
              <button
                type="button"
                onClick={() => openAuthModal({ redirect: '/' })}
                className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
              >
                去登录
              </button>
            </div>
          ) : isLoading && conversations.length === 0 ? (
            <div className="flex flex-col gap-2 pt-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 w-full rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : conversations.length > 0 ? (
            conversations.map((convo) => {
              const deletingThis = deletingConversationId === convo.id;
              return (
              <div
                key={convo.id}
                onClick={() => {
                  if (isDeleting) return;
                  void setActiveConversationId(convo.id);
                }}
                className={`group relative flex w-full items-center justify-between rounded-lg p-3 text-sm font-medium transition-colors cursor-pointer
                  ${
                    activeConversationId === convo.id
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50'
                  }
                  ${deletingThis ? 'opacity-60 pointer-events-none' : ''}`
                }
              >
                <span className="truncate pr-2">{convo.title}</span>
                {canMutate && (
                  <Button
                    variant="ghost"
                    size="icon"
                    // 只 disabled 当前条：Button 自带 disabled:opacity-50，会把其它条的 opacity-0 顶掉
                    disabled={deletingThis}
                    onClick={(e) => handleDelete(e, convo.id)}
                    className={`h-7 w-7 shrink-0 transition-opacity ${
                      deletingThis
                        ? 'opacity-100 disabled:opacity-100'
                        : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    {deletingThis ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    <span className="sr-only">
                      {deletingThis ? '删除中' : 'Delete Conversation'}
                    </span>
                  </Button>
                )}
              </div>
              );
            })
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground text-sm pt-10">
              <p>还没有历史记录</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

