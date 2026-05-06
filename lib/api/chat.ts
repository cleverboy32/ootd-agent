import { Conversation, Message } from '@/lib/types';

const API_BASE = '/api';

/**
 * Fetches all conversations for a given client ID.
 * @param clientId The ID of the client.
 * @returns A promise that resolves to an array of conversations.
 */
export const getConversations = async (clientId: string): Promise<Conversation[]> => {
  const response = await fetch(`${API_BASE}/conversations?clientId=${clientId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch conversations');
  }
  return response.json();
};

/**
 * Creates a new conversation.
 * @param title The title of the new conversation.
 * @param clientId The ID of the client creating the conversation.
 * @returns A promise that resolves to the newly created conversation.
 */
export const createConversation = async (title: string, clientId: string): Promise<Conversation> => {
  const response = await fetch(`${API_BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, clientId }),
  });
  if (!response.ok) {
    throw new Error('Failed to create conversation');
  }
  return response.json();
};

/**
 * Deletes a specific conversation.
 * @param conversationId The ID of the conversation to delete.
 * @returns A promise that resolves when the conversation is successfully deleted.
 */
export const deleteConversation = async (conversationId: string): Promise<void> => {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    // Even if the body is empty on a 204, a failed response will likely have a body
    const errorBody = await response.json().catch(() => ({ message: 'Failed to delete conversation' }));
    throw new Error(errorBody.message || 'Failed to delete conversation');
  }

  // No need to return a body for a successful DELETE request
};

/**
 * Fetches all messages for a specific conversation.
 * @param conversationId The ID of the conversation.
 * @returns A promise that resolves to an array of messages.
 */
export const getMessages = async (conversationId: string): Promise<Message[]> => {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/messages`);
  if (!response.ok) {
    throw new Error('Failed to fetch messages');
  }
  return response.json();
};

/**
 * Posts a new message to a conversation.
 * @param conversationId The ID of the conversation.
 * @param message The message object to post.
 * @returns A promise that resolves to the newly created message.
 */
export const postMessage = async (conversationId: string, message: { role: string; content: any }): Promise<Message> => {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!response.ok) {
    throw new Error('Failed to post message');
  }
  return response.json();
};

