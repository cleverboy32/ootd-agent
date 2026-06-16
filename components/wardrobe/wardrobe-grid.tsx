"use client";

import React from 'react';
import Image from 'next/image';
import { Trash2, Check } from 'lucide-react';
import type { ClothingItem } from '@prisma/client';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface WardrobeGridProps {
  items: ClothingItem[];
  isLoading: boolean;
  error: string | null;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onDeleteItem?: (id: string) => void;
  isDeleting?: boolean;
}

export function WardrobeGrid({
  items,
  isLoading,
  error,
  selectionMode = false,
  selectedIds = new Set(),
  onToggleSelect,
  onDeleteItem,
  isDeleting = false,
}: WardrobeGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 mt-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex aspect-square items-center justify-center p-0">
              <Skeleton className="w-full h-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="mt-6 text-center text-red-500">{error}</p>;
  }

  if (items.length === 0) {
    return <p className="mt-6 text-center text-muted-foreground">该分类下暂无衣物，快去添加一件吧！</p>;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 mt-6">
      {items.map((item) => {
        const isSelected = selectedIds.has(item.id);

        return (
          <Card
            key={item.id}
            className={cn(
              'overflow-hidden group relative',
              selectionMode && isSelected && 'ring-2 ring-primary'
            )}
          >
            <CardContent className="p-0 relative aspect-square">
              {selectionMode ? (
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => onToggleSelect?.(item.id)}
                  className="absolute inset-0 z-10 flex items-start justify-end p-2"
                  aria-label={isSelected ? '取消选择' : '选择衣物'}
                >
                  <span
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full border-2 bg-background/90 shadow-sm transition-colors',
                      isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
                    )}
                  >
                    {isSelected && <Check className="size-3.5" />}
                  </span>
                </button>
              ) : (
                <Button
                  type="button"
                  variant="destructive"
                  size="icon-xs"
                  disabled={isDeleting}
                  onClick={() => onDeleteItem?.(item.id)}
                  className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="删除衣物"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}

              <Image
                src={item.imageUrl}
                alt={item.description || item.subCategory || 'Clothing item'}
                fill
                sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
                className="object-cover"
                priority={false}
                unoptimized
              />

              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-2 pt-6">
                <p className="truncate text-xs text-white">{item.subCategory}</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
