'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Heart } from 'lucide-react';
import { savedOutfitChatHref } from '@/lib/api/savedOutfits';
import { useSavedOutfitsStore } from '@/store/savedOutfits';

export function SidebarRight() {
  const items = useSavedOutfitsStore((s) => s.items);
  const loading = useSavedOutfitsStore((s) => s.loading);
  const authenticated = useSavedOutfitsStore((s) => s.authenticated);
  const recent = items.slice(0, 3);

  return (
    <aside className="w-72 border-l border-border p-6 bg-muted/10 hidden lg:block shrink-0">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="font-semibold text-foreground">我的搭配</h3>
        <Link
          href="/collect"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          查看全部
        </Link>
      </div>

      {loading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      )}

      {!loading && !authenticated && (
        <p className="text-sm text-muted-foreground">
          登录后可收藏喜欢的穿搭方案
        </p>
      )}

      {!loading && authenticated && recent.length === 0 && (
        <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
          <Heart className="size-5 text-muted-foreground/50" />
          <p>还没有收藏。对话里点效果图上的心形即可收藏。</p>
        </div>
      )}

      {!loading && authenticated && recent.length > 0 && (
        <ul className="space-y-3">
          {recent.map((item) => {
            const href = savedOutfitChatHref(item) ?? '/collect';
            return (
              <li key={item.id}>
                <Link
                  href={href}
                  className="flex gap-3 rounded-xl border border-border/60 bg-background p-2 transition-colors hover:border-[var(--gold)]"
                >
                  <div className="relative h-16 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {item.coverImageUrl ? (
                      <Image
                        src={item.coverImageUrl}
                        alt={item.title}
                        fill
                        unoptimized
                        className="object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1 py-0.5">
                    <p className="line-clamp-2 text-sm font-medium leading-snug">
                      {item.title}
                    </p>
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      {item.snapshot.items.map((i) => i.name).join(' · ')}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
