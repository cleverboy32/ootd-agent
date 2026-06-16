import { getClientId } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';

const API_BASE = '/api';

export interface WardrobeItemData {
  id: string;
  name: string;
  imageUrl: string;
}

export const getWardrobeItem = async (itemId: string): Promise<WardrobeItemData> => {
  return apiClient.get(`${API_BASE}/wardrobe/${itemId}`);
};

export const deleteWardrobeItem = async (itemId: string): Promise<{ deletedCount: number }> => {
  const response = await apiClient.delete(`${API_BASE}/wardrobe/${itemId}`);
  return response.json();
};

export const deleteWardrobeItems = async (itemIds: string[]): Promise<{ deletedCount: number }> => {
  const response = await fetch('/api/wardrobe', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-ID': getClientId(),
    },
    body: JSON.stringify({ ids: itemIds }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: `HTTP error! Status: ${response.status}` }));
    throw new Error(errorBody.error || errorBody.message || `HTTP error! Status: ${response.status}`);
  }

  return response.json();
};
