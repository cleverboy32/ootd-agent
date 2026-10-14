import { create } from 'zustand';
import { Conversation, Message, MessageContentPart } from '@/lib/types';
import * as chatApi from '@/lib/api/chat';

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Message[];
  /** `before` cursor for the next older page; null when the oldest message is loaded */
  nextCursor: string | null;
  isLoading: boolean;
  isLoadingOlder: boolean;
  waitReply: boolean;
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
  deleteConversation: (conversationId: string) => Promise<void>;
}

export const useChatStore = create<ChatState & ChatActions>((set, get) => ({
  // --- 初始状态 ---
  conversations: [],
  activeConversationId: null,
  messages: [],
  nextCursor: null,
  isLoading: false,
  isLoadingOlder: false,
  waitReply: false,
  
  // --- Actions 实现 ---
  setLoading: (isLoading) => set({ isLoading }),
  setWaitReply: (waiting) => set({ waitReply: waiting }),

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
    const { conversations, activeConversationId } = get();
    try {
      // 1. Call the API function
      await chatApi.deleteConversation(conversationId);

      // 2. Filter out the deleted conversation from local state
      const updatedConversations = conversations.filter(c => c.id !== conversationId);
      
      const newState: Partial<ChatState> = {
        conversations: updatedConversations,
      };

      // 3. If active conversation is deleted, reset the view
      if (activeConversationId === conversationId) {
        newState.activeConversationId = null;
        newState.messages = [];
        newState.nextCursor = null;
      }

      set(newState);

    } catch (error) {
      console.error("Failed to delete conversation", error);
      // Here you could add feedback for the user
    }
  },
  
  // ... inside the create<ChatState & ChatActions>((set, get) => ({ ...

  // Find your existing setActiveConversationId and replace it with this:
  setActiveConversationId: async (id) => {
    if (id === get().activeConversationId) return;

    if (!id) {
      set({ activeConversationId: null, messages: [], nextCursor: null, isLoading: false, isLoadingOlder: false });
      return;
    }

    set({ activeConversationId: id, messages: [], nextCursor: null, isLoading: true, isLoadingOlder: false });
    const { messages, nextCursor } = await chatApi.getMessages(id);
    if (get().activeConversationId === id) {
      set({ messages, nextCursor, isLoading: false });
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
        return { messages: [...older, ...state.messages], nextCursor: page.nextCursor };
      });
    } catch (error) {
      console.error("Failed to load older messages", error);
    } finally {
      if (get().activeConversationId === id) set({ isLoadingOlder: false });
    }
  },

  // 乐观渲染：建会话（含首条消息，单次往返）期间用户消息已上屏
  startNewConversation: async (userMessage) => {
    set({ activeConversationId: null, messages: [userMessage], nextCursor: null, isLoadingOlder: false });
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

      set({ activeConversationId: newConversation.id });
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
    
    set({ messages: [...messages, userMessage] });
    try {
      await chatApi.postMessage(activeConversationId, { role: 'user', content: userMessage.content });
    } catch (error) {
      console.error("Failed to save user message", error);
      // 可选: 实现回滚逻辑
    }
  },
  
  updateMessages: (updater) => {
    set(state => ({
      messages: updater(state.messages)
    }));
  },
}));

