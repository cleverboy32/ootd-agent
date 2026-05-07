import { create } from 'zustand';
import { Conversation, Message } from '@/lib/types';
import * as chatApi from '@/lib/api/chat';

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Message[];
  isLoading: boolean;
  clientId: string | null;
}

interface ChatActions {
  // --- 基础 Actions ---
  setClientId: (clientId: string) => void;
  fetchConversations: () => Promise<void>;
  setActiveConversationId: (id: string | null) => void;
  
  // --- 原子化的消息 Actions (供编排者调用) ---
  startNewConversation: (userMessage: Message) => Promise<string | undefined>;
  addUserMessage: (userMessage: Message) => Promise<void>;
  updateMessages: (updater: (messages: Message[]) => Message[]) => void; // The new powerful action
  saveFinalAiMessage: () => Promise<void>;
  setLoading: (isLoading: boolean) => void;
  deleteConversation: (conversationId: string) => Promise<void>;
}

export const useChatStore = create<ChatState & ChatActions>((set, get) => ({
  // --- 初始状态 ---
  conversations: [],
  activeConversationId: null,
  messages: [],
  isLoading: false,
  clientId: null,
  
  // --- Actions 实现 ---
  setClientId: (clientId) => set({ clientId }),
  setLoading: (isLoading) => set({ isLoading }),

  fetchConversations: async () => {
    const { clientId } = get();
    if (!clientId) return;

    set({ isLoading: true });
    try {
      const conversations = await chatApi.getConversations(clientId);
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
      set({ activeConversationId: null, messages: [], isLoading: false });
      return;
    }

    set({ activeConversationId: id, messages: [], isLoading: true });
    const messages = await chatApi.getMessages(id);
    if (get().activeConversationId === id) {
      set({ messages, isLoading: false });
    }
  },

  startNewConversation: async (userMessage) => {
    const { clientId, conversations } = get();
    if (!clientId) return;
    
    try {
      const newConversation = await chatApi.createConversation(userMessage.content, clientId);
      await chatApi.postMessage(newConversation.id, { role: userMessage.role, content: userMessage.content });
      
      set({
        conversations: [newConversation, ...conversations],
        activeConversationId: newConversation.id,
        messages: [userMessage],
      });
      return newConversation.id;
    } catch (error) {
      console.error("Failed to start new conversation", error);
    }
  },
  
  addUserMessage: async (userMessage) => {
    const { activeConversationId, messages } = get();
    if (!activeConversationId) return;
    
    set({ messages: [...messages, userMessage] });
    try {
      await chatApi.postMessage(activeConversationId, { role: userMessage.role, content: userMessage.content });
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
  
  saveFinalAiMessage: async () => {
    const { activeConversationId, messages } = get();
    const lastMessage = messages.at(-1);
    if (!activeConversationId || !lastMessage || lastMessage.role !== 'ai') return;
    
    try {
      await chatApi.postMessage(activeConversationId, { role: lastMessage.role, content: lastMessage.content });
    } catch (error) {
      console.error("Failed to save final AI message", error);
    }
  }
}));
