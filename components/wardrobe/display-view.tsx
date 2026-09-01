"use client";

import React, { useState, useEffect, useCallback } from 'react';
import type { ClothingItem } from '@prisma/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WardrobeGrid } from '@/components/wardrobe/wardrobe-grid';
import { Button } from '@/components/ui/button';
import { getClientId, withBasePath } from '@/lib/utils';
import { deleteWardrobeItem, deleteWardrobeItems } from '@/lib/api/wardrobe';
import { useAccess } from '@/components/access/AccessProvider';

const categories = [
  { value: 'all', label: '全部' },
  { value: 'TOP', label: '上装' },
  { value: 'BOTTOM', label: '下装' },
  { value: 'OUTERWEAR', label: '外套' },
  { value: 'FOOTWEAR', label: '鞋履' },
  { value: 'ACCESSORY', label: '配饰' },
  { value: 'ONE_PIECE', label: '连身' },
] as const;

async function requestWardrobeItems(): Promise<{ items: ClothingItem[] } | { error: string }> {
  const currentClientId = getClientId();
  if (!currentClientId) {
    return { error: '无法获取客户端ID，请刷新页面重试' };
  }

  try {
    const response = await fetch(withBasePath('/api/wardrobe'), { headers: { 'X-Client-ID': currentClientId } });
    if (!response.ok) throw new Error('获取衣橱物品失败。');
    const data: ClothingItem[] = await response.json();
    return { items: data };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { error: errorMessage };
  }
}

export function DisplayView() {
  const { canMutate } = useAccess();
  const [items, setItems] = useState<ClothingItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchItems = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    const result = await requestWardrobeItems();
    if ('error' in result) {
      setFetchError(result.error);
    } else {
      setItems(result.items);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    let active = true;

    void requestWardrobeItems().then((result) => {
      if (!active) return;
      if ('error' in result) {
        setFetchError(result.error);
      } else {
        setItems(result.items);
      }
      setIsLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  const getFilteredItems = useCallback(
    (category: string) =>
      category === 'all' ? items : items.filter((item) => item.mainCategory === category),
    [items]
  );

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllInTab = () => {
    const filtered = getFilteredItems(activeTab);
    setSelectedIds(new Set(filtered.map((item) => item.id)));
  };

  const removeItemsFromState = (ids: string[]) => {
    const idSet = new Set(ids);
    setItems((prev) => prev.filter((item) => !idSet.has(item.id)));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  };

  const handleDeleteItem = async (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    const label = item?.subCategory || '这件衣物';
    if (!window.confirm(`确定删除「${label}」吗？删除后需重新上传。`)) return;

    setIsDeleting(true);
    try {
      await deleteWardrobeItem(itemId);
      removeItemsFromState([itemId]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '删除失败';
      window.alert(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`确定删除选中的 ${selectedIds.size} 件衣物吗？删除后需重新上传。`)) return;

    setIsDeleting(true);
    try {
      const ids = [...selectedIds];
      const { deletedCount } = await deleteWardrobeItems(ids);
      removeItemsFromState(ids.slice(0, deletedCount));
      if (deletedCount < ids.length) {
        await fetchItems();
      }
      exitSelectionMode();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '批量删除失败';
      window.alert(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const visibleCount = getFilteredItems(activeTab).length;
  const allVisibleSelected = visibleCount > 0 && getFilteredItems(activeTab).every((item) => selectedIds.has(item.id));

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">共 {items.length} 件衣物</p>

        {canMutate && <div className="flex flex-wrap items-center gap-2">
          {selectionMode ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isDeleting || visibleCount === 0}
                onClick={allVisibleSelected ? () => setSelectedIds(new Set()) : handleSelectAllInTab}
              >
                {allVisibleSelected ? '取消全选' : '全选当前分类'}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={isDeleting || selectedIds.size === 0}
                onClick={handleDeleteSelected}
              >
                {isDeleting ? '删除中...' : `删除选中 (${selectedIds.size})`}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={isDeleting} onClick={exitSelectionMode}>
                完成
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isLoading || items.length === 0}
              onClick={() => setSelectionMode(true)}
            >
              批量管理
            </Button>
          )}
        </div>}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4 sm:grid-cols-7">
          {categories.map((category) => (
            <TabsTrigger key={category.value} value={category.value}>
              {category.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {categories.map((category) => (
          <TabsContent key={category.value} value={category.value}>
            <WardrobeGrid
              isLoading={isLoading}
              error={fetchError}
              items={getFilteredItems(category.value)}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onDeleteItem={handleDeleteItem}
              isDeleting={isDeleting}
              readOnly={!canMutate}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
