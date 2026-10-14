import { apiClient } from "@/lib/api-client";
import { mapDbMessagesToClient } from "@/lib/mappers/message";
import { Conversation, Message, MessageContentPart } from "@/lib/types";

const API_BASE = '/api';

/**
 * Fetches all conversations for the current client.
 * clientId is automatically handled by apiClient.
 * @returns A promise that resolves to an array of conversations.
 */
export const getConversations = async (): Promise<Conversation[]> => {
  // 2. 使用 apiClient.get，不再需要手动处理 response 和 error
  // 注意：我们还需要修改后端的 GET /api/conversations 接口，让它从请求头读取 clientId
  return apiClient.get(`${API_BASE}/conversations`);
};

/**
 * Creates a new conversation.
 * clientId is automatically handled by apiClient.
 * @param title The title of the new conversation.
 * @param firstMessage Optional first user message, persisted in the same request.
 * @returns A promise that resolves to the newly created conversation.
 */
export const createConversation = async (
  title: string,
  firstMessage?: { role: 'user'; content: MessageContentPart[] }
): Promise<Conversation> => {
  return apiClient.post(`${API_BASE}/conversations`, { title, firstMessage });
};

/**
 * Deletes a specific conversation.
 * @param conversationId The ID of the conversation to delete.
 */
export const deleteConversation = async (conversationId: string): Promise<void> => {
  // 4. DELETE 请求通常没有返回值，所以我们只调用它
  await apiClient.delete(`${API_BASE}/conversations/${conversationId}`);
};

export interface MessagePageResult {
  /** Chronological order. */
  messages: Message[];
  /** Pass as `before` to fetch the previous page; null when there are no older messages. */
  nextCursor: string | null;
}

/**
 * Fetches one page of messages for a specific conversation.
 * @param conversationId The ID of the conversation.
 * @param options `before` cursor (omit for the latest page) and page `limit`.
 */
export const getMessages = async (
  conversationId: string,
  options: { before?: string; limit?: number } = {}
): Promise<MessagePageResult> => {
  const query = new URLSearchParams();
  if (options.before) query.set('before', options.before);
  if (options.limit) query.set('limit', String(options.limit));
  const qs = query.toString();

  const raw = (await apiClient.get(
    `${API_BASE}/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`
  )) as { messages: Parameters<typeof mapDbMessagesToClient>[0]; nextCursor: string | null };

  return { messages: mapDbMessagesToClient(raw.messages), nextCursor: raw.nextCursor };
};

/**
 * Posts a new message to a conversation.
 * @param conversationId The ID of the conversation.
 * @param message The message object to post.
 * @returns A promise that resolves to the newly created message.
 */
export const postMessage = async (conversationId: string, message: { role: 'user'; content: MessageContentPart[] }): Promise<Message> => {
  return apiClient.post(`${API_BASE}/conversations/${conversationId}/messages`, message);
};