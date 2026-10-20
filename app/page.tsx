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
import { outfitImageAnchorId } from "@/lib/api/savedOutfits";
import { stripBasePath } from "@/lib/utils";

function FashionAIPageInner() {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  /** 用户上翻阅读历史时置 false，回到底部时恢复，避免流式输出把视图拽回底部 */
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const prevLastMessageRef = useRef<Message | undefined>(undefined);
  /** 正在处理的深链 key；URL 清空后复位，允许同卡再点 */
  const deepLinkHandledRef = useRef<string | null>(null);
  const pendingScrollMessageIdRef = useRef<string | null>(null);
  const pendingScrollOutfitIdRef = useRef<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();

  const {
    messages,
    isLoading,
    waitReply,
    activeConversationId,
    fetchConversations,
    setActiveConversationId,
    loadOlderMessages,
  } = useChatStore();

  const { handleSend } = useChatHandler();
  const lastMessage = messages.at(-1);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  /** 优先滚到效果图：block=end 让图落在视口下方，避开底部输入栏 */
  function tryScrollToOutfit(messageId: string, outfitId: string | null): boolean {
    const outfitEl =
      outfitId && document.getElementById(outfitImageAnchorId(messageId, outfitId));
    const el = outfitEl ?? document.getElementById(`message-${messageId}`);
    if (!el) return false;
    stickToBottomRef.current = false;
    el.scrollIntoView({
      behavior: "smooth",
      block: outfitEl ? "end" : "center",
    });
    return true;
  }

  // 收藏跳转：/?c=&m=&o= → 打开会话并滚到效果图
  // 同会话时 setActiveConversationId 会短路，必须在此处直接滚动
  useEffect(() => {
    const conversationId = searchParams.get("c");
    const messageId = searchParams.get("m");
    const outfitId = searchParams.get("o");
    if (!conversationId || !messageId) {
      deepLinkHandledRef.current = null;
      return;
    }

    const key = `${conversationId}:${messageId}:${outfitId ?? ""}`;
    if (deepLinkHandledRef.current === key) return;
    deepLinkHandledRef.current = key;

    pendingScrollMessageIdRef.current = messageId;
    pendingScrollOutfitIdRef.current = outfitId;
    stickToBottomRef.current = false;

    void (async () => {
      const alreadyOpen =
        useChatStore.getState().activeConversationId === conversationId;

      if (!alreadyOpen) {
        await setActiveConversationId(conversationId);
      }

      // 同会话：图已在 DOM 则立刻滚；若在更早分页里则往上翻页直到找到
      let attempts = 0;
      while (
        pendingScrollMessageIdRef.current === messageId &&
        attempts < 20
      ) {
        if (tryScrollToOutfit(messageId, outfitId)) {
          pendingScrollMessageIdRef.current = null;
          pendingScrollOutfitIdRef.current = null;
          break;
        }
        const { nextCursor, isLoadingOlder, messages: msgs } =
          useChatStore.getState();
        const alreadyLoaded = msgs.some((m) => m.id === messageId);
        if (alreadyLoaded || !nextCursor || isLoadingOlder) break;
        await loadOlderMessages();
        // 等 DOM 挂上再找锚点
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
        attempts += 1;
      }

      router.replace(stripBasePath("/") || "/");
    })();
  }, [searchParams, setActiveConversationId, loadOlderMessages, router]);

  // 切会话加载完成后，再尝试滚一次（异步加载场景）
  useEffect(() => {
    const messageId = pendingScrollMessageIdRef.current;
    if (!messageId || isLoading || messages.length === 0) return;
    if (tryScrollToOutfit(messageId, pendingScrollOutfitIdRef.current)) {
      pendingScrollMessageIdRef.current = null;
      pendingScrollOutfitIdRef.current = null;
    }
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
