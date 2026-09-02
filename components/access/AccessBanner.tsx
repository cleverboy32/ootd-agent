"use client";

import { FormEvent, useState } from "react";
import { usePathname } from "next/navigation";
import { LockKeyhole, LogOut, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAccess } from "./AccessProvider";

export function AccessBanner() {
  const pathname = usePathname();
  const { mode, configured, verify, logout } = useAccess();
  const [expanded, setExpanded] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Chat home has header actions on the right, so sit below it.
  // Other pages have an empty header corner — sit there instead of covering content actions.
  const overlayClass = pathname === "/"
    ? "fixed right-3 top-16 z-50"
    : "fixed right-4 top-3 z-50 lg:right-6";

  if (mode === "loading") return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await verify(code);
      setCode("");
      setExpanded(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "验证失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (mode === "verified") {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void logout()}
        className={cn(overlayClass, "gap-1.5 bg-background/90 shadow-sm backdrop-blur")}
      >
        <LogOut className="h-3.5 w-3.5" />
        退出完整模式
      </Button>
    );
  }

  return (
    <aside className={cn(overlayClass, "w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur")}>
      <div className="flex items-center gap-2">
        <LockKeyhole className="h-4 w-4 shrink-0 text-amber-600" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-medium">浏览模式</span>
          <span className="ml-1 text-muted-foreground">仅可查看数据</span>
        </p>
        <Button
          type="button"
          variant={expanded ? "ghost" : "default"}
          size="sm"
          disabled={!configured}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <X className="h-4 w-4" /> : "输入访问码"}
        </Button>
      </div>

      {!configured && (
        <p className="mt-2 text-xs text-destructive">服务端尚未配置访问码。</p>
      )}

      {expanded && (
        <form onSubmit={handleSubmit} className="mt-3 space-y-2">
          <Input
            type="password"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="访问码"
            autoComplete="current-password"
            autoFocus
            className="focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={!code || submitting}>
            {submitting ? "验证中…" : "解锁完整功能"}
          </Button>
        </form>
      )}
    </aside>
  );
}
