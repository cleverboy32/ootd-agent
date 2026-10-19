import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

interface MainHeaderProps {
  activeView: 'display' | 'add';
  onBackToDisplay?: () => void;
}

const viewTitles = {
  display: '衣橱总览',
  add: '添加衣物',
};

const backClassName =
  'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground';

export function MainHeader({ activeView, onBackToDisplay }: MainHeaderProps) {
  return (
    <header className="h-14 flex items-center gap-2 px-6 bg-background/80 backdrop-blur-sm sticky top-0 z-10 border-b border-border/40">
      {activeView === 'add' ? (
        <button
          type="button"
          onClick={onBackToDisplay}
          aria-label="返回衣橱总览"
          className={backClassName}
        >
          <ArrowLeft className="size-4" />
        </button>
      ) : (
        <Link href="/" aria-label="返回首页" className={backClassName}>
          <ArrowLeft className="size-4" />
        </Link>
      )}
      <h2 className="font-semibold text-foreground">{viewTitles[activeView]}</h2>
    </header>
  );
}
