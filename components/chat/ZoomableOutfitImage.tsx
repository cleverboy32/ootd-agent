'use client';

import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { cn } from '@/lib/utils';

const PREVIEW_MAX_WIDTH = 420;
const PREVIEW_GAP = 12;

interface ZoomableOutfitImageProps {
  src: string;
  alt: string;
  className?: string;
}

export function ZoomableOutfitImage({ src, alt, className }: ZoomableOutfitImageProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [previewPos, setPreviewPos] = useState<{ left: number; top: number } | null>(null);

  const showPreview = useCallback(() => {
    const el = anchorRef.current;
    if (!el || typeof window === 'undefined') return;

    const rect = el.getBoundingClientRect();
    const previewWidth = Math.min(PREVIEW_MAX_WIDTH, window.innerWidth * 0.5);
    const previewHeight = Math.min(PREVIEW_MAX_WIDTH, window.innerHeight * 0.55);

    let left = rect.right + PREVIEW_GAP;
    if (left + previewWidth > window.innerWidth - PREVIEW_GAP) {
      left = rect.left - previewWidth - PREVIEW_GAP;
    }
    left = Math.max(PREVIEW_GAP, left);

    let top = rect.top + rect.height / 2 - previewHeight / 2;
    top = Math.max(PREVIEW_GAP, Math.min(top, window.innerHeight - previewHeight - PREVIEW_GAP));

    setPreviewPos({ left, top });
  }, []);

  const hidePreview = useCallback(() => setPreviewPos(null), []);

  return (
    <>
      <span
        ref={anchorRef}
        className="relative inline-block my-3 max-w-[200px] align-middle"
        onMouseEnter={showPreview}
        onMouseLeave={hidePreview}
        onFocus={showPreview}
        onBlur={hidePreview}
      >
        <Image
          src={src}
          alt={alt}
          width={200}
          height={200}
          unoptimized
          tabIndex={0}
          className={cn(
            'h-auto w-full rounded-xl border border-border/10 cursor-zoom-in outline-none',
            'transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary/40',
            className
          )}
        />
      </span>

      {previewPos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[200] animate-in fade-in-0 zoom-in-95 duration-150"
            style={{ left: previewPos.left, top: previewPos.top }}
            aria-hidden
          >
            <Image
              src={src}
              alt=""
              width={PREVIEW_MAX_WIDTH}
              height={PREVIEW_MAX_WIDTH}
              unoptimized
              className="max-h-[min(420px,55vh)] w-auto max-w-[min(420px,50vw)] rounded-xl border border-border/50 bg-background shadow-2xl"
            />
          </div>,
          document.body
        )}
    </>
  );
}
