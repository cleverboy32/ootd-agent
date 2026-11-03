'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

type GuideBubbleProps = {
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  onActionClick?: () => void;
  onDismiss: () => void;
  className?: string;
  /** 小三角朝向（指向锚点） */
  arrow?: 'top' | 'bottom' | 'left' | 'right' | 'none';
  /** 三角水平位置（贴导航按钮时用 end） */
  arrowAlign?: 'start' | 'end';
};

export function GuideBubble({
  title,
  description,
  actionLabel,
  actionHref,
  onActionClick,
  onDismiss,
  className,
  arrow = 'bottom',
  arrowAlign = 'start',
}: GuideBubbleProps) {
  const arrowX = arrowAlign === 'end' ? 'right-8' : 'left-8';

  return (
    <div
      role="dialog"
      aria-label={title}
      className={cn(
        'relative z-40 w-max max-w-[min(18rem,calc(100vw-2rem))] rounded-xl bg-[var(--gold)] px-3 py-2.5 text-background shadow-lg',
        className
      )}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="关闭引导"
        className="absolute right-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded-full text-background/80 transition-colors hover:bg-background/15 hover:text-background"
      >
        <X className="size-3" />
      </button>

      <p className="pr-5 text-xs font-semibold leading-snug whitespace-nowrap">{title}</p>
      {description && (
        <p className="mt-0.5 pr-4 text-[11px] leading-relaxed text-background/85">{description}</p>
      )}

      {(actionLabel && actionHref) || (actionLabel && onActionClick) ? (
        actionHref ? (
          <Link
            href={actionHref}
            onClick={onActionClick}
            className="mt-2.5 inline-flex rounded-full bg-background px-3 py-1 text-xs font-medium text-foreground transition-opacity hover:opacity-90"
          >
            {actionLabel}
          </Link>
        ) : (
          <button
            type="button"
            onClick={onActionClick}
            className="mt-2.5 inline-flex rounded-full bg-background px-3 py-1 text-xs font-medium text-foreground transition-opacity hover:opacity-90"
          >
            {actionLabel}
          </button>
        )
      ) : null}

      {arrow === 'bottom' && (
        <span
          aria-hidden
          className={cn('absolute -bottom-1.5 size-3 rotate-45 bg-[var(--gold)]', arrowX)}
        />
      )}
      {arrow === 'top' && (
        <span
          aria-hidden
          className={cn('absolute -top-1.5 size-3 rotate-45 bg-[var(--gold)]', arrowX)}
        />
      )}
      {arrow === 'left' && (
        <span
          aria-hidden
          className="absolute top-1/2 -left-1.5 size-3 -translate-y-1/2 rotate-45 bg-[var(--gold)]"
        />
      )}
      {arrow === 'right' && (
        <span
          aria-hidden
          className="absolute top-1/2 -right-1.5 size-3 -translate-y-1/2 rotate-45 bg-[var(--gold)]"
        />
      )}
    </div>
  );
}
