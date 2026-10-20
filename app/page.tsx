"use client";
import { Suspense, useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SidebarLeft } from "@/components/chat/SidebarLeft";
import { SidebarRight } from "@/components/chat/SidebarRight";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatMessagesList } from "@/components/chat/ChatMessagesList";
import { GreetingSection } from "@/components/chat/GreetingSection";
import { ChatInputArea } from "@/components/chat/ChatInputArea";
import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";
import { useChatStore } from "@/store/chat";
import type { Message } from "@/lib/types";
import { useChatHandler } from "@/hooks/useChatHandler";
import { stripBasePath } from "@/lib/utils";

function FashionAIPageInner() {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  /** 用户上翻阅读历史时置 false，回到底部时恢复，避免流式输出把视图拽回底部 */
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const prevLastMessageRef = useRef<Message | undefined>(undefined);
  const deepLinkHandledRef = useRef<string | null>(null);
  const pendingScrollMessageIdRef = useRef<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();

  const {
    messages,
    isLoading,
    waitReply,
    activeConversationId,
    fetchConversations,
    setActiveConversationId,
  } = useChatStore();

  const { handleSend } = useChatHandler();
  const lastMessage = messages.at(-1);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // 收藏跳转：/?c=conversationId&m=messageId → 打开会话并滚到消息
  useEffect(() => {
    const conversationId = searchParams.get("c");
    const messageId = searchParams.get("m");
    if (!conversationId) return;

    const key = `${conversationId}:${messageId ?? ""}`;
    if (deepLinkHandledRef.current === key) return;
    deepLinkHandledRef.current = key;

    pendingScrollMessageIdRef.current = messageId;
    stickToBottomRef.current = false;
    void (async () => {
      await setActiveConversationId(conversationId);
      // 清掉 query，避免刷新反复跳
      router.replace(stripBasePath("/") || "/");
    })();
  }, [searchParams, setActiveConversationId, router]);

  // 会话加载完成后滚到目标消息
  useEffect(() => {
    const messageId = pendingScrollMessageIdRef.current;
    if (!messageId || isLoading || messages.length === 0) return;

    const el = document.getElementById(`message-${messageId}`);
    if (!el) return;
    stickToBottomRef.current = false;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      pendingScrollMessageIdRef.current = null;
    });
  }, [messages, isLoading, activeConversationId]);

  useEffect(() => {
    // 深链定位中不要被「切会话贴底」抢走
    if (pendingScrollMessageIdRef.current) return;
    stickToBottomRef.current = true;
  }, [activeConversationId]);

  // 只跟随尾部变化（新消息 / 流式更新）；头部插入历史消息时 lastMessage 引用不变，不触发
  useEffect(() => {
    const prev = prevLastMessageRef.current;
    prevLastMessageRef.current = lastMessage;
    if (!lastMessage) return;

    const isInitialPaint = !prev;
    const isOwnNewMessage = lastMessage.id !== prev?.id && lastMessage.role === 'user';
    if (isInitialPaint || isOwnNewMessage) stickToBottomRef.current = true;
    if (!stickToBottomRef.current) return;

    // 首屏瞬时定位：平滑滚动期间顶部 sentinel 可见，会误触发加载更早消息
    messagesEndRef.current?.scrollIntoView({ behavior: isInitialPaint ? "auto" : "smooth" });
  }, [lastMessage, waitReply]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom < 80) {
      stickToBottomRef.current = true;
    } else if (el.scrollTop < lastScrollTopRef.current) {
      stickToBottomRef.current = false;
    }
    lastScrollTopRef.current = el.scrollTop;
  };

  const handleNewChat = () => {
    setActiveConversationId(null);
  };

  return (
    <div className="flex h-screen bg-background text-foreground font-sans overflow-hidden">
      <SidebarLeft 
        onNewChat={handleNewChat}
      />
      <main className="flex-1 flex flex-col relative overflow-hidden bg-background">
        <ChatHeader />
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto no-scrollbar pb-32 [overflow-anchor:none]"
        >
          {!activeConversationId && messages.length === 0 ? (
            <GreetingSection handleSend={handleSend} />
          ) : (
            <ChatMessagesList messagesEndRef={messagesEndRef} scrollContainerRef={scrollContainerRef} />
          )}
        </div>

        <ChatInputArea
          input={input}
          setInput={setInput}
          handleSend={handleSend}
          isLoading={isLoading}
        />
      </main>

      <SidebarRight />

      {/* Floating Help Button */}
      <div className="fixed bottom-6 right-6 z-30 lg:hidden">
        <Button variant="outline" size="icon" className="h-12 w-12 rounded-full border-border shadow-lg bg-background hover:bg-accent text-muted-foreground">
          <HelpCircle className="h-6 w-6" />
        </Button>
      </div>
    </div>
  );
}

export default function FashionAIPage() {
  return (
    <Suspense fallback={null}>
      <FashionAIPageInner />
    </Suspense>
  );
}
