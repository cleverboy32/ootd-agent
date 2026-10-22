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
    setDeepLinkPin,
  } = useChatStore();

  const { handleSend } = useChatHandler();
  const lastMessage = messages.at(-1);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  /** 有 o= 时必须命中效果图锚点，不能先滚到气泡再当成功（否则图挂上后位置已偏） */
  function resolveOutfitEl(
    messageId: string,
    outfitId: string | null
  ): HTMLElement | null {
    if (outfitId) {
      return document.getElementById(
        outfitImageAnchorId(messageId, outfitId)
      );
    }
    return document.getElementById(`message-${messageId}`);
  }

  function waitFrames(n = 2): Promise<void> {
    return new Promise((resolve) => {
      const step = (left: number) => {
        if (left <= 0) resolve();
        else requestAnimationFrame(() => step(left - 1));
      };
      step(n);
    });
  }

  async function waitImages(el: HTMLElement): Promise<void> {
    const imgs = Array.from(el.querySelectorAll("img"));
    await Promise.all(
      imgs.map(
        (img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.addEventListener("load", () => resolve(), { once: true });
                img.addEventListener("error", () => resolve(), { once: true });
              })
      )
    );
  }

  async function waitUntilNotLoadingOlder(): Promise<void> {
    for (let i = 0; i < 60; i++) {
      if (!useChatStore.getState().isLoadingOlder) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /**
   * 定位效果图：instant 避免与翻页 scrollTop 补偿打架；
   * 等图 + 高度稳定后再停，解决「需加载历史时最终位置不准」。
   */
  async function scrollToOutfitSettled(
    messageId: string,
    outfitId: string | null
  ): Promise<boolean> {
    stickToBottomRef.current = false;
    await waitFrames(2);
    const el = resolveOutfitEl(messageId, outfitId);
    if (!el) return false;

    const block: ScrollLogicalPosition = outfitId ? "end" : "center";
    const align = () => {
      const current = resolveOutfitEl(messageId, outfitId);
      current?.scrollIntoView({ behavior: "instant", block });
    };

    align();
    await waitImages(el);
    const msgEl = document.getElementById(`message-${messageId}`);
    if (msgEl) await waitImages(msgEl);
    await waitFrames(2);
    align();

    // 翻页后上方懒加载图还会撑高，滚动条位置会漂；稳定后再停
    const scroller = scrollContainerRef.current;
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 80));
      const before = scroller?.scrollTop ?? 0;
      align();
      const after = scroller?.scrollTop ?? 0;
      if (Math.abs(after - before) < 2) break;
    }
    return !!resolveOutfitEl(messageId, outfitId);
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
    setDeepLinkPin(true);

    void (async () => {
      try {
        const alreadyOpen =
          useChatStore.getState().activeConversationId === conversationId;

        if (!alreadyOpen) {
          await setActiveConversationId(conversationId);
          await waitUntilNotLoadingOlder();
          // 等首屏消息渲染
          for (let i = 0; i < 40; i++) {
            if (
              !useChatStore.getState().isLoading &&
              useChatStore.getState().messages.length > 0
            ) {
              break;
            }
            await new Promise((r) => setTimeout(r, 50));
          }
        }

        // 翻页直到目标消息进入 store，再等 DOM 锚点
        let attempts = 0;
        while (
          pendingScrollMessageIdRef.current === messageId &&
          attempts < 40
        ) {
          const { nextCursor, messages: msgs } = useChatStore.getState();
          const alreadyLoaded = msgs.some((m) => m.id === messageId);

          if (alreadyLoaded) {
            if (await scrollToOutfitSettled(messageId, outfitId)) {
              pendingScrollMessageIdRef.current = null;
              pendingScrollOutfitIdRef.current = null;
              break;
            }
            // 有 o= 但效果图锚点未挂上：等几轮；末次退回消息气泡
            if (outfitId && attempts >= 35) {
              if (await scrollToOutfitSettled(messageId, null)) {
                pendingScrollMessageIdRef.current = null;
                pendingScrollOutfitIdRef.current = null;
                break;
              }
            }
            await new Promise((r) => setTimeout(r, 100));
            attempts += 1;
            continue;
          }

          if (!nextCursor) break;
          await loadOlderMessages();
          await waitUntilNotLoadingOlder();
          await waitFrames(2);
          attempts += 1;
        }
      } finally {
        setDeepLinkPin(false);
        router.replace(stripBasePath("/") || "/");
      }
    })();
  }, [
    searchParams,
    setActiveConversationId,
    loadOlderMessages,
    setDeepLinkPin,
    router,
  ]);

  // 切会话异步加载：若主流程尚未滚到，再补一次
  useEffect(() => {
    const messageId = pendingScrollMessageIdRef.current;
    if (!messageId || isLoading || messages.length === 0) return;
    if (useChatStore.getState().deepLinkPin) return;
    void (async () => {
      if (
        await scrollToOutfitSettled(
          messageId,
          pendingScrollOutfitIdRef.current
        )
      ) {
        pendingScrollMessageIdRef.current = null;
        pendingScrollOutfitIdRef.current = null;
      }
    })();
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
