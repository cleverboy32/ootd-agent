import { apiClient } from "@/lib/api-client";

const API_BASE = '/api';

// 定义我们期望从 API 获取的数据类型
export interface WardrobeItemData {
  id: string;
  name: string;
  imageUrl: string;
}

/**
 * Fetches a single wardrobe item by its ID.
 * The clientId is automatically handled by the apiClient.
 * @param itemId The ID of the wardrobe item to fetch.
 * @returns A promise that resolves to the wardrobe item's data.
 */
export const getWardrobeItem = async (itemId: string): Promise<WardrobeItemData> => {
  return apiClient.get(`${API_BASE}/wardrobe/${itemId}`);
};