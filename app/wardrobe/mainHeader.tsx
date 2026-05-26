interface MainHeaderProps {
  activeView: 'display' | 'add';
}

const viewTitles = {
  display: '衣橱总览',
  add: '添加衣物',
};

export function MainHeader({ activeView }: MainHeaderProps) {
  return (
    <header className="h-14 flex items-center justify-between px-6 bg-background/80 backdrop-blur-sm sticky top-0 z-10 border-b border-border/40">
      <h2 className="font-semibold text-foreground">{viewTitles[activeView]}</h2>
    </header>
  );
}