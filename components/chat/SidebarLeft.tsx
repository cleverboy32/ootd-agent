"use client";

import Image from "next/image";
import { Search, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import React from "react";
import { useChatStore } from "@/store/chat";
import { useAccess } from "@/components/access/AccessProvider";
import { LOGO_SRC } from "@/lib/utils";

// The Conversation type is no longer needed here as it's managed by the store
// import { Conversation } from "@/lib/types";

// Update Props interface - remove props that are now managed by the store
interface SidebarLeftProps {
  onNewChat: () => void;
}

export function SidebarLeft({ 
  onNewChat,
}: SidebarLeftProps) {
  const { canMutate } = useAccess();
  // Get state and actions directly from the store
  const { conversations, activeConversationId, setActiveConversationId, deleteConversation, isLoading } = useChatStore();

  // Handler for the delete button click
  const handleDelete = (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation(); // Prevents the click from also triggering the setActiveConversationId
    // Optional: You could add a confirmation dialog here
    // if (window.confirm('Are you sure you want to delete this chat?')) {
      deleteConversation(conversationId);
    // }
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
            className="pl-9 h-10 rounded-xl bg-background border-border shadow-sm"
          />
        </div>
      </div>

      {/* --- New Chat Button (unchanged) --- */}
      {canMutate && <div className="px-4 mb-6">
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
      </div>}

      {/* --- Conversation History List (Updated) --- */}
      <div className="flex-1 overflow-y-auto px-4">
        <div className="flex flex-col gap-2">
          {/* Condition 1: Initial Loading State */}
          {isLoading && conversations.length === 0 ? (
            <div className="flex flex-col gap-2 pt-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 w-full rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : conversations.length > 0 ? (
            /* Condition 2: Conversations are loaded */
            conversations.map((convo) => (
              <div
                key={convo.id}
                onClick={() => setActiveConversationId(convo.id)}
                className={`group relative flex w-full items-center justify-between rounded-lg p-3 text-sm font-medium transition-colors cursor-pointer
                  ${
                    activeConversationId === convo.id
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50'
                  }`
                }
              >
                <span className="truncate pr-2">{convo.title}</span>
                {canMutate && <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => handleDelete(e, convo.id)}
                  className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">Delete Conversation</span>
                </Button>}
              </div>
            ))
          ) : (
            /* Condition 3: No conversations and not loading */
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground text-sm pt-10">
              <p>还没有历史记录</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

