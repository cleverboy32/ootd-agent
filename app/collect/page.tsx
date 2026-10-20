'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Heart, Trash2 } from 'lucide-react';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { savedOutfitChatHref } from '@/lib/api/savedOutfits';
import { useSavedOutfitsStore } from '@/store/savedOutfits';

export default function CollectPage() {
  const items = useSavedOutfitsStore((s) => s.items);
  const loading = useSavedOutfitsStore((s) => s.loading);
  const authenticated = useSavedOutfitsStore((s) => s.authenticated);
  const removeById = useSavedOutfitsStore((s) => s.removeById);

  return (
    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      <AppSidebar activeSection="collect" />

      <div className="flex flex-col">
        <header className="flex h-14 items-center gap-2 border-b px-4 lg:h-15 lg:px-6">
          <Link
            href="/"
            aria-label="返回首页"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="text-lg font-semibold">我的搭配</h1>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {loading && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="aspect-[3/4] w-full rounded-xl" />
              ))}
            </div>
          )}

          {!loading && !authenticated && (
            <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
              <Heart className="size-10 text-muted-foreground/40" />
              <div className="space-y-1">
                <p className="font-medium text-foreground">登录后查看收藏</p>
                <p className="text-sm text-muted-foreground">
                  收藏的穿搭方案会同步到你的账号
                </p>
              </div>
              <Button asChild>
                <Link href={`/login?redirect=${encodeURIComponent('/collect')}`}>
                  去登录
                </Link>
              </Button>
            </div>
          )}

          {!loading && authenticated && items.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
              <Heart className="size-10 text-muted-foreground/40" />
              <div className="space-y-1">
                <p className="font-medium text-foreground">还没有收藏</p>
                <p className="text-sm text-muted-foreground">
                  在对话里给喜欢的效果图点心形，就会出现在这里
                </p>
              </div>
              <Button variant="outline" asChild>
                <Link href="/">去对话</Link>
              </Button>
            </div>
          )}

          {!loading && authenticated && items.length > 0 && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((item) => {
                const chatHref = savedOutfitChatHref(item);
                return (
                  <article
                    key={item.id}
                    className="group relative overflow-hidden rounded-xl border border-border bg-card"
                  >
                    <div className="relative aspect-[3/4] bg-muted">
                      {chatHref ? (
                        <Link href={chatHref} className="absolute inset-0 block">
                          {item.coverImageUrl ? (
                            <Image
                              src={item.coverImageUrl}
                              alt={item.title}
                              fill
                              unoptimized
                              className="object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                              暂无封面
                            </div>
                          )}
                        </Link>
                      ) : item.coverImageUrl ? (
                        <Image
                          src={item.coverImageUrl}
                          alt={item.title}
                          fill
                          unoptimized
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                          暂无封面
                        </div>
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        aria-label="取消收藏"
                        className="absolute right-2 top-2 z-10 size-8 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void removeById(item.id);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    <div className="space-y-1 p-3">
                      {chatHref ? (
                        <Link href={chatHref} className="block">
                          <h2 className="line-clamp-2 text-sm font-medium leading-snug hover:underline">
                            {item.title}
                          </h2>
                        </Link>
                      ) : (
                        <h2 className="line-clamp-2 text-sm font-medium leading-snug">
                          {item.title}
                        </h2>
                      )}
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        {item.snapshot.items.map((i) => i.name).join(' · ') || '—'}
                      </p>
                      {chatHref && (
                        <p className="text-xs text-muted-foreground/80">点击查看原对话</p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
