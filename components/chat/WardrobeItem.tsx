'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Skeleton } from '@/components/ui/skeleton';
import { getWardrobeItem, type WardrobeItemData } from '@/lib/api/wardrobe';

interface WardrobeItemProps {
  itemId: string;
}

export function WardrobeItem({ itemId }: WardrobeItemProps) {
  const [item, setItem] = useState<WardrobeItemData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchItem = async () => {
      try {
        const result = await getWardrobeItem(itemId);
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
    // 加载时显示一个与最终样式类似的骨架屏
    return (
      <span className="inline-flex items-center align-middle">
        <Skeleton className="h-6 w-32 rounded-full" />
      </span>
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
      href={`/wardrobe?itemId=${item.id}`} // 链接到衣橱详情页（可选）
      target="_blank"
      rel="noopener noreferrer"
      // [MODIFIED] Removed background, adjusted colors, and increased size for a cleaner look.
      className="inline-flex items-center align-middle text-foreground rounded-full px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
    >
      <Image
        src={item.imageUrl}
        alt={item.name}
        width={40}
        height={40}
        unoptimized
        className="h-10 w-10 rounded-full mr-2 object-cover border-border"
      />
      <span className="truncate">{item.name}</span>
    </a>
  );
}