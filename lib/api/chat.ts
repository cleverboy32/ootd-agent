import { apiClient } from "@/lib/api-client"; // 1. 导入我们新的 apiClient
import { Conversation, Message } from "@/lib/types";

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
 * @returns A promise that resolves to the newly created conversation.
 */
export const createConversation = async (title: string): Promise<Conversation> => {
  // 3. 使用 apiClient.post，body 里只需要核心数据
  return apiClient.post(`${API_BASE}/conversations`, { title });
};

/**
 * Deletes a specific conversation.
 * @param conversationId The ID of the conversation to delete.
 */
export const deleteConversation = async (conversationId: string): Promise<void> => {
  // 4. DELETE 请求通常没有返回值，所以我们只调用它
  await apiClient.delete(`${API_BASE}/conversations/${conversationId}`);
};

/**
 * Fetches all messages for a specific conversation.
 * @param conversationId The ID of the conversation.
 * @returns A promise that resolves to an array of messages.
 */
export const getMessages = async (conversationId: string): Promise<Message[]> => {
  return apiClient.get(`${API_BASE}/conversations/${conversationId}/messages`);
};

/**
 * Posts a new message to a conversation.
 * @param conversationId The ID of the conversation.
 * @param message The message object to post.
 * @returns A promise that resolves to the newly created message.
 */
export const postMessage = async (conversationId: string, message: { role: string; content: any }): Promise<Message> => {
  return apiClient.post(`${API_BASE}/conversations/${conversationId}/messages`, message);
};