"use client";

import React, { useState, useEffect, useCallback } from 'react';
import type { ClothingItem } from '@prisma/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WardrobeGrid } from '@/components/wardrobe/wardrobe-grid';
import { getClientId } from '@/lib/utils';

export function DisplayView() {
  const [items, setItems] = useState<ClothingItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);


  const fetchItems = useCallback(async () => {
    const currentClientId = getClientId();
    if (!currentClientId) {
        setFetchError("无法获取客户端ID，请刷新页面重试");
        setIsLoading(false);
        return;
    }

    setIsLoading(true);
    setFetchError(null);
    try {
      const response = await fetch('/api/wardrobe', { headers: { 'X-Client-ID': currentClientId } });
      if (!response.ok) throw new Error('获取衣橱物品失败。');
      const data: ClothingItem[] = await response.json();
      setItems(data);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setFetchError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchItems();
  }, [fetchItems]);

  const categories = [
    { value: 'all', label: '全部' },
    { value: 'TOP', label: '上装' },
    { value: 'BOTTOM', label: '下装' },
    { value: 'OUTERWEAR', label: '外套' },
    { value: 'FOOTWEAR', label: '鞋履' },
    { value: 'ACCESSORY', label: '配饰' },
    { value: 'ONE_PIECE', label: '连身' },
  ];

  return (
    <Tabs defaultValue="all" className="w-full">
      <TabsList className="grid w-full grid-cols-4 sm:grid-cols-7">
        {categories.map(category => (
          <TabsTrigger key={category.value} value={category.value}>
            {category.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {categories.map(category => (
        <TabsContent key={category.value} value={category.value}>
          <WardrobeGrid
            isLoading={isLoading}
            error={fetchError}
            items={
              category.value === 'all'
                ? items
                : items.filter(item => item.mainCategory === category.value)
            }
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}