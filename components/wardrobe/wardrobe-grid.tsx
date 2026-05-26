"use client";

import React from 'react';
import Image from 'next/image';
import type { ClothingItem } from '@prisma/client';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface WardrobeGridProps {
  items: ClothingItem[];
  isLoading: boolean;
  error: string | null;
}

export function WardrobeGrid({ items, isLoading, error }: WardrobeGridProps) {
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
      {items.map(item => (
        <Card key={item.id} className="overflow-hidden">
          <CardContent className="p-0 relative aspect-square">
            <Image
              src={item.imageUrl}
              alt={item.description || 'Clothing item'}
              fill
              sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
              className="object-cover"
              priority={false}
              unoptimized
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}