'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ZoomableOutfitImageProps {
  src: string;
  alt: string;
  className?: string;
}

export function ZoomableOutfitImage({ src, alt, className }: ZoomableOutfitImageProps) {
  const [open, setOpen] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const openLightbox = useCallback(() => setOpen(true), []);
  const closeLightbox = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => closeBtnRef.current?.focus(), 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={openLightbox}
        aria-label={`放大查看：${alt}`}
        className={cn(
          'relative my-3 inline-block max-w-[200px] align-middle border-0 bg-transparent p-0 text-left',
          'rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
        )}
      >
        <Image
          src={src}
          alt=""
          width={200}
          height={200}
          unoptimized
          className={cn(
            'h-auto w-full rounded-xl border border-border/10 cursor-zoom-in',
            'transition-shadow hover:shadow-md',
            className
          )}
        />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 animate-in fade-in-0 duration-150"
            onClick={closeLightbox}
          >
            <span id={titleId} className="sr-only">
              {alt}
            </span>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={closeLightbox}
              aria-label="关闭全屏预览"
              className="absolute right-4 top-4 z-[1] rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
            <div
              className="relative flex max-h-full max-w-full items-center justify-center"
              onClick={(event) => event.stopPropagation()}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- fullscreen natural sizing */}
              <img
                src={src}
                alt={alt}
                className="max-h-[min(100vh-2rem,100dvh-2rem)] max-w-[min(100vw-2rem,100dvw-2rem)] object-contain"
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
