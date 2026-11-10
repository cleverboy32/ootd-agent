"use client";

import React, { useState, useEffect, useCallback } from 'react';
import type { ClothingItem } from '@prisma/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WardrobeGrid } from '@/components/wardrobe/wardrobe-grid';
import { Button } from '@/components/ui/button';
import { deleteWardrobeItem, deleteWardrobeItems, reanalyzeWardrobeItem } from '@/lib/api/wardrobe';
import { useAccess } from '@/components/access/AccessProvider';
import { useOnboardingStore } from '@/store/onboarding';
import { useWardrobeItemsStore } from '@/store/wardrobe-items-store';

const categories = [
  { value: 'all', label: '全部' },
  { value: 'TOP', label: '上装' },
  { value: 'BOTTOM', label: '下装' },
  { value: 'OUTERWEAR', label: '外套' },
  { value: 'FOOTWEAR', label: '鞋履' },
  { value: 'ACCESSORY', label: '配饰' },
  { value: 'ONE_PIECE', label: '连身' },
] as const;

interface DisplayViewProps {
  onAddItems?: () => void;
}

export function DisplayView({ onAddItems }: DisplayViewProps) {
  const { canMutate } = useAccess();
  const items = useWardrobeItemsStore((s) => s.items);
  const isLoading = useWardrobeItemsStore((s) => s.loading || (!s.loaded && !s.error));
  const fetchError = useWardrobeItemsStore((s) => s.error);
  const ensureLoaded = useWardrobeItemsStore((s) => s.ensureLoaded);
  const upsert = useWardrobeItemsStore((s) => s.upsert);
  const removeIds = useWardrobeItemsStore((s) => s.removeIds);
  const syncHasWardrobe = useOnboardingStore((s) => s.syncHasWardrobe);

  const [activeTab, setActiveTab] = useState<string>('all');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);

  useEffect(() => {
    let active = true;
    void ensureLoaded()
      .then(() => {
        if (!active) return;
        syncHasWardrobe();
      })
      .catch(() => {
        // error 已写入 store
      });
    return () => {
      active = false;
    };
  }, [ensureLoaded, syncHasWardrobe]);

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

  const clearSelected = (ids: string[]) => {
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
      removeIds([itemId]);
      clearSelected([itemId]);
      syncHasWardrobe();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '删除失败';
      window.alert(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReanalyzeSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`重新分析选中的 ${selectedIds.size} 件衣物？失败的会保留原描述。`)) return;

    setIsReanalyzing(true);
    const failed: string[] = [];
    try {
      for (const id of selectedIds) {
        try {
          const updated = (await reanalyzeWardrobeItem(id)) as ClothingItem;
          upsert(updated);
        } catch {
          failed.push(id);
        }
      }
      if (failed.length > 0) {
        window.alert(`${failed.length} 件重新分析失败，原描述还在。`);
      }
    } finally {
      setIsReanalyzing(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`确定删除选中的 ${selectedIds.size} 件衣物吗？删除后需重新上传。`)) return;

    setIsDeleting(true);
    try {
      const ids = [...selectedIds];
      const { deletedCount } = await deleteWardrobeItems(ids);
      removeIds(ids.slice(0, deletedCount));
      clearSelected(ids);
      if (deletedCount < ids.length) {
        await ensureLoaded({ force: true });
      }
      syncHasWardrobe();
      exitSelectionMode();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '批量删除失败';
      window.alert(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const visibleCount = getFilteredItems(activeTab).length;
  const allVisibleSelected =
    visibleCount > 0 && getFilteredItems(activeTab).every((item) => selectedIds.has(item.id));

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">共 {items.length} 件衣物</p>

        {canMutate && (
          <div className="flex flex-wrap items-center gap-2">
            {selectionMode ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isDeleting || isReanalyzing || visibleCount === 0}
                  onClick={allVisibleSelected ? () => setSelectedIds(new Set()) : handleSelectAllInTab}
                >
                  {allVisibleSelected ? '取消全选' : '全选当前分类'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isDeleting || isReanalyzing || selectedIds.size === 0}
                  onClick={handleReanalyzeSelected}
                >
                  {isReanalyzing ? '分析中...' : `重新分析选中 (${selectedIds.size})`}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={isDeleting || isReanalyzing || selectedIds.size === 0}
                  onClick={handleDeleteSelected}
                >
                  {isDeleting ? '删除中...' : `删除选中 (${selectedIds.size})`}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isDeleting || isReanalyzing}
                  onClick={exitSelectionMode}
                >
                  完成
                </Button>
              </>
            ) : (
              <>
                {onAddItems && (
                  <Button type="button" size="sm" onClick={onAddItems}>
                    添加衣物
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isLoading || items.length === 0}
                  onClick={() => setSelectionMode(true)}
                >
                  批量管理
                </Button>
              </>
            )}
          </div>
        )}
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
