'use client';

import Image from 'next/image';

export interface WardrobeCandidateItem {
  id: string;
  imageUrl: string;
  subCategory: string;
  colors: string[];
}

interface WardrobeCandidatePickerProps {
  items: WardrobeCandidateItem[];
  onSelect: (itemId: string) => void;
  disabled?: boolean;
}

export function WardrobeCandidatePicker({
  items,
  onSelect,
  disabled = false,
}: WardrobeCandidatePickerProps) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 mt-3">
      {items.map((item) => {
        const colorLabel = item.colors?.length ? item.colors.join(' / ') : '';
        const label = [item.subCategory, colorLabel].filter(Boolean).join(' · ');

        return (
          <button
            key={item.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(item.id)}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-border/60 bg-background p-2 transition-colors hover:border-primary/50 hover:bg-muted/30 disabled:opacity-50 disabled:pointer-events-none max-w-[120px]"
          >
            <Image
              src={item.imageUrl}
              alt={label || '衣橱单品'}
              width={96}
              height={96}
              unoptimized
              className="h-24 w-24 rounded-lg object-cover border border-border/40"
            />
            <span className="text-xs text-muted-foreground text-center line-clamp-2 px-1">
              {label || '衣橱单品'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
