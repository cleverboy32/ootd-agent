'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { getWardrobeItem, type WardrobeItemData } from '@/lib/api/wardrobe';

// 简单的内存缓存，防止重复请求导致的抖动
const wardrobeCache: Map<string, WardrobeItemData> = new Map();

interface WardrobeItemProps {
  itemId: string;
}

export function WardrobeItem({ itemId }: WardrobeItemProps) {
  const [item, setItem] = useState<WardrobeItemData | null>(wardrobeCache.get(itemId) || null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!wardrobeCache.has(itemId));

  useEffect(() => {
    // 如果缓存已有数据，直接返回，避免闪烁
    if (wardrobeCache.has(itemId)) return;

    const fetchItem = async () => {
      setLoading(true);
      try {
        const result = await getWardrobeItem(itemId);
        wardrobeCache.set(itemId, result);
        setItem(result);
      } catch (e) {
        console.error('Failed to fetch wardrobe item:', e);
        setError(e instanceof Error ? e.message : '加载失败。');
      } finally {
        setLoading(false);
      }
    };

    fetchItem();
  }, [itemId]);

  if (loading) {
    // 改为使用 span 实现骨架屏，防止 div 导致的非法嵌套报错
    return (
      <span className="inline-flex items-center align-middle h-6 w-32 rounded-full animate-pulse bg-muted/50" />
    );
  }

  if (error || !item) {
    return (
      <span className="inline-flex items-center align-middle bg-destructive/10 text-destructive border border-destructive/20 rounded-full px-2.5 py-1 text-xs font-medium">
        {error || '物品信息出错'}
      </span>
    );
  }

  return (
    <a
      href={`/wardrobe?itemId=${item.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center align-middle text-foreground rounded-full px-3 text-sm font-medium transition-colors hover:bg-muted"
    >
      <Image
        src={item.imageUrl}
        alt={item.name}
        width={40}
        height={40}
        unoptimized
        className="h-10 w-10  mr-2 object-cover border-border"
      />
    </a>
  );
}

