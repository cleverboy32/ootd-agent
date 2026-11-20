import { create } from 'zustand';
import { getActiveGenerationId } from '@/lib/chat/activeGeneration';
import { maybeResumeGeneratingMessage } from '@/lib/chat/resumeGenerating';
import { Conversation, Message, MessageContentPart } from '@/lib/types';
import * as chatApi from '@/lib/api/chat';

const GENERATING_POLL_MS = 2000;
let generatingPollTimer: ReturnType<typeof setInterval> | null = null;
let generatingPollConversationId: string | null = null;

function stopGeneratingPoll(): void {
  if (generatingPollTimer) {
    clearInterval(generatingPollTimer);
    generatingPollTimer = null;
  }
  generatingPollConversationId = null;
}

function hasGeneratingAi(messages: Message[]): boolean {
  return messages.some((m) => m.role === 'ai' && m.status === 'generating');
}

/** 会话级消息缓存：切走再回来时直接还原，避免重复全屏 loading */
interface CachedConversationMessages {
  messages: Message[];
  nextCursor: string | null;
}

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Message[];
  /** `before` cursor for the next older page; null when the oldest message is loaded */
  nextCursor: string | null;
  /** 本会话内已打开过的会话消息（内存，刷新仍丢） */
  messageCache: Record<string, CachedConversationMessages>;
  isLoading: boolean;
  isLoadingOlder: boolean;
  /** 正在删除的会话 id；null 表示无删除中 */
  deletingConversationId: string | null;
  waitReply: boolean;
  /**
   * 收藏深链定位中：头部插入更早消息时不要做 scrollTop 补偿，
   * 否则会顶掉 scrollIntoView 的最终位置。
   */
  deepLinkPin: boolean;
}

interface ChatActions {
  // --- 基础 Actions ---
  fetchConversations: () => Promise<void>;
  setActiveConversationId: (id: string | null) => void;
  loadOlderMessages: () => Promise<void>;
  
  // --- 原子化的消息 Actions (供编排者调用) ---
  startNewConversation: (userMessage: Message) => Promise<string>;
  persistNewConversation: (userMessage: Message) => Promise<string>;
  addUserMessage: (userMessage: Message) => Promise<void>;
  updateMessages: (updater: (messages: Message[]) => Message[]) => void; // The new powerful action
  setLoading: (isLoading: boolean) => void;
  setWaitReply: (waiting: boolean) => void;
  setDeepLinkPin: (pinned: boolean) => void;
  deleteConversation: (conversationId: string) => Promise<void>;
}

function withActiveCache(
  state: ChatState,
  messages: Message[],
  nextCursor: string | null = state.nextCursor
): Pick<ChatState, 'messages' | 'nextCursor' | 'messageCache'> {
  const { activeConversationId, messageCache } = state;
  if (!activeConversationId) {
    return { messages, nextCursor, messageCache };
  }
  return {
    messages,
    nextCursor,
    messageCache: {
      ...messageCache,
      [activeConversationId]: { messages, nextCursor },
    },
  };
}

/**
 * resume 404（他机 / buffer 已丢）时的短轮询兜底：直到非 generating。
 * 本 Tab 正在 live/resume SSE 时不轮询，避免空 DB 草稿盖掉已流式内容。
 */
async function pollGeneratingOnce(
  get: () => ChatState & ChatActions,
  set: (partial: Partial<ChatState> | ((s: ChatState & ChatActions) => Partial<ChatState>)) => void,
  conversationId: string
): Promise<boolean> {
  if (getActiveGenerationId() !== 0) return true;
  if (get().activeConversationId !== conversationId) return false;

  try {
    const page = await chatApi.getMessages(conversationId);
    if (get().activeConversationId !== conversationId) return false;
    if (getActiveGenerationId() !== 0) return true;

    const still = hasGeneratingAi(page.messages);
    set((state) => ({
      ...withActiveCache(state, page.messages, page.nextCursor ?? state.nextCursor),
      waitReply: still,
    }));
    return still;
  } catch (error) {
    console.warn('[CHAT] generating poll failed:', error);
    return get().activeConversationId === conversationId && hasGeneratingAi(get().messages);
  }
}

function startGeneratingPoll(
  get: () => ChatState & ChatActions,
  set: (partial: Partial<ChatState> | ((s: ChatState & ChatActions) => Partial<ChatState>)) => void,
  conversationId: string
): void {
  stopGeneratingPoll();
  generatingPollConversationId = conversationId;

  const tick = () => {
    void pollGeneratingOnce(get, set, conversationId).then((still) => {
      if (!still && generatingPollConversationId === conversationId) {
        stopGeneratingPoll();
      }
    });
  };

  void tick();
  generatingPollTimer = setInterval(tick, GENERATING_POLL_MS);
}

/** 主路径：resume SSE；失败再轮询。本 Tab 已有 live 流则跳过。 */
function resumeOrPollGenerating(
  get: () => ChatState & ChatActions,
  set: (partial: Partial<ChatState> | ((s: ChatState & ChatActions) => Partial<ChatState>)) => void,
  conversationId: string
): void {
  if (getActiveGenerationId() !== 0) return;
  if (!hasGeneratingAi(get().messages)) return;

  void maybeResumeGeneratingMessage({
    getMessages: () => get().messages,
    updateMessages: (updater) => {
      set((state) => withActiveCache(state, updater(state.messages)));
    },
    setWaitReply: (waiting) => set({ waitReply: waiting }),
    startPollFallback: () => {
      if (get().activeConversationId === conversationId) {
        startGeneratingPoll(get, set, conversationId);
      }
    },
    refreshMessages: async () => {
      if (get().activeConversationId !== conversationId) return;
      try {
        const page = await chatApi.getMessages(conversationId);
        if (get().activeConversationId !== conversationId) return;
        set((state) => ({
          ...withActiveCache(state, page.messages, page.nextCursor ?? state.nextCursor),
          waitReply: hasGeneratingAi(page.messages),
        }));
      } catch (error) {
        console.warn('[CHAT] refresh after resume terminal failed:', error);
      }
    },
  });
}

export const useChatStore = create<ChatState & ChatActions>((set, get) => ({
  // --- 初始状态 ---
  conversations: [],
  activeConversationId: null,
  messages: [],
  nextCursor: null,
  messageCache: {},
  isLoading: false,
  isLoadingOlder: false,
  deletingConversationId: null,
  waitReply: false,
  deepLinkPin: false,
  
  // --- Actions 实现 ---
  setLoading: (isLoading) => set({ isLoading }),
  setWaitReply: (waiting) => set({ waitReply: waiting }),
  setDeepLinkPin: (pinned) => set({ deepLinkPin: pinned }),

  fetchConversations: async () => {
    set({ isLoading: true });
    try {
      const conversations = await chatApi.getConversations();
      set({ conversations });
    } catch (error) {
      console.error("Error fetching conversations:", error);
      set({ conversations: [] });
    } finally {
      set({ isLoading: false });
    }
  },

  deleteConversation: async (conversationId) => {
    if (get().deletingConversationId) return;
    const { conversations, activeConversationId, messageCache } = get();
    set({ deletingConversationId: conversationId });
    try {
      await chatApi.deleteConversation(conversationId);

      const updatedConversations = conversations.filter(c => c.id !== conversationId);
      const { [conversationId]: _removed, ...restCache } = messageCache;

      const newState: Partial<ChatState> = {
        conversations: updatedConversations,
        messageCache: restCache,
        deletingConversationId: null,
      };

      if (activeConversationId === conversationId) {
        newState.activeConversationId = null;
        newState.messages = [];
        newState.nextCursor = null;
      }

      set(newState);
    } catch (error) {
      console.error("Failed to delete conversation", error);
      set({ deletingConversationId: null });
    }
  },

  setActiveConversationId: async (id) => {
    if (id === get().activeConversationId) return;

    stopGeneratingPoll();

    // 切走前把当前会话写入缓存
    const prev = get();
    let messageCache = prev.messageCache;
    if (prev.activeConversationId) {
      messageCache = {
        ...messageCache,
        [prev.activeConversationId]: {
          messages: prev.messages,
          nextCursor: prev.nextCursor,
        },
      };
    }

    if (!id) {
      set({
        activeConversationId: null,
        messages: [],
        nextCursor: null,
        isLoading: false,
        isLoadingOlder: false,
        waitReply: false,
        messageCache,
      });
      return;
    }

    const cached = messageCache[id];
    if (cached) {
      const cachedGenerating = hasGeneratingAi(cached.messages);
      set({
        activeConversationId: id,
        messages: cached.messages,
        nextCursor: cached.nextCursor,
        isLoading: false,
        isLoadingOlder: false,
        waitReply: cachedGenerating,
        messageCache,
      });
      if (cachedGenerating) resumeOrPollGenerating(get, set, id);
      return;
    }

    set({
      activeConversationId: id,
      messages: [],
      nextCursor: null,
      isLoading: true,
      isLoadingOlder: false,
      waitReply: false,
      messageCache,
    });
    const { messages, nextCursor } = await chatApi.getMessages(id);
    if (get().activeConversationId === id) {
      const generating = hasGeneratingAi(messages);
      set(state => ({
        ...withActiveCache(state, messages, nextCursor),
        isLoading: false,
        waitReply: generating,
      }));
      if (generating) resumeOrPollGenerating(get, set, id);
    }
  },

  loadOlderMessages: async () => {
    const { activeConversationId: id, nextCursor, isLoading, isLoadingOlder } = get();
    if (!id || !nextCursor || isLoading || isLoadingOlder) return;

    // 切换会话会重置 cursor，游标不变才说明响应仍对应当前视图
    const isCurrent = () => get().activeConversationId === id && get().nextCursor === nextCursor;

    set({ isLoadingOlder: true });
    try {
      const page = await chatApi.getMessages(id, { before: nextCursor });
      if (!isCurrent()) return;
      set(state => {
        const loaded = new Set(state.messages.map(m => m.id));
        const older = page.messages.filter(m => !loaded.has(m.id));
        const messages = [...older, ...state.messages];
        return withActiveCache(state, messages, page.nextCursor);
      });
    } catch (error) {
      console.error("Failed to load older messages", error);
    } finally {
      if (get().activeConversationId === id) set({ isLoadingOlder: false });
    }
  },

  // 乐观渲染：建会话（含首条消息，单次往返）期间用户消息已上屏
  startNewConversation: async (userMessage) => {
    const prev = get();
    let messageCache = prev.messageCache;
    if (prev.activeConversationId) {
      messageCache = {
        ...messageCache,
        [prev.activeConversationId]: {
          messages: prev.messages,
          nextCursor: prev.nextCursor,
        },
      };
    }
    set({
      activeConversationId: null,
      messages: [userMessage],
      nextCursor: null,
      isLoadingOlder: false,
      messageCache,
    });
    return get().persistNewConversation(userMessage);
  },

  /** 为已上屏的首条消息建会话并落库；失败时标记 sendFailed 供重试，返回空串 */
  persistNewConversation: async (userMessage) => {
    const createTitleFromContent = (content: string | MessageContentPart[]): string => {
      if (typeof content === 'string') {
        return content.substring(0, 50);
      }
      const textPart = content.find(part => part.type === 'text');
      return textPart ? textPart.content.substring(0, 50) : 'New Conversation';
    };

    try {
      const newConversation = await chatApi.createConversation(
        createTitleFromContent(userMessage.content),
        { role: 'user', content: userMessage.content }
      );

      set(state => ({ conversations: [newConversation, ...state.conversations] }));
      // 等待期间用户已切走（新建/切换会话）则不抢回视图，也不让调用方继续往当前视图流式写入
      const { activeConversationId, messages } = get();
      if (activeConversationId !== null || messages[0]?.id !== userMessage.id) return '';

      set(state => ({
        activeConversationId: newConversation.id,
        messageCache: {
          ...state.messageCache,
          [newConversation.id]: {
            messages: state.messages,
            nextCursor: state.nextCursor,
          },
        },
      }));
      return newConversation.id;
    } catch (error) {
      console.error("Failed to start new conversation", error);
      set(state => ({
        messages: state.messages.map(m => m.id === userMessage.id ? { ...m, sendFailed: true } : m),
      }));
      return '';
    }
  },
  
  addUserMessage: async (userMessage) => {
    const { activeConversationId, messages } = get();
    if (!activeConversationId) return;

    set(state => withActiveCache(state, [...messages, userMessage]));
    try {
      await chatApi.postMessage(activeConversationId, { role: 'user', content: userMessage.content });
    } catch (error) {
      console.error("Failed to save user message", error);
    }
  },
  
  updateMessages: (updater) => {
    set(state => withActiveCache(state, updater(state.messages)));
  },
}));

