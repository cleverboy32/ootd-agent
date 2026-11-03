'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Sparkles, Ticket } from 'lucide-react';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAccess } from '@/components/access/AccessProvider';
import {
  fetchCredits,
  redeemCode,
  type CreditLedgerItem,
} from '@/lib/api/billing';
import { cn } from '@/lib/utils';

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function CreditsSettingsPage() {
  const router = useRouter();
  const { ready, authenticated } = useAccess();
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<CreditLedgerItem[]>([]);
  const [code, setCode] = useState('');
  const [redeemError, setRedeemError] = useState('');
  const [redeemOk, setRedeemOk] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      router.push('/login?redirect=/settings/credits');
      return;
    }
    let cancelled = false;
    fetchCredits(50)
      .then((data) => {
        if (cancelled) return;
        setBalance(data.balance);
        setLedger(data.ledger);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) router.push('/login?redirect=/settings/credits');
      });
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, router]);

  async function onRedeem(e: FormEvent) {
    e.preventDefault();
    setRedeemError('');
    setRedeemOk('');
    setRedeeming(true);
    try {
      const result = await redeemCode(code);
      setBalance(result.balance);
      setRedeemOk(`已加 ${result.creditsAdded} 次，当前剩余 ${result.balance} 次`);
      setCode('');
      const data = await fetchCredits(50);
      setLedger(data.ledger);
    } catch (err) {
      setRedeemError(err instanceof Error ? err.message : '兑换失败');
    } finally {
      setRedeeming(false);
    }
  }

  return (
    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      <AppSidebar activeSection="profile" />
      <div className="flex flex-col">
        <header className="flex h-14 items-center gap-2 border-b px-4 lg:h-15 lg:px-6">
          <Link
            href="/"
            aria-label="返回"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="text-lg font-semibold">账单</h1>
        </header>

        <main className="flex-1 overflow-y-auto bg-muted/30 p-4 lg:p-6">
          <div className="w-full space-y-4">
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-36 w-full rounded-2xl" />
                <Skeleton className="h-28 w-full rounded-2xl" />
                <Skeleton className="h-48 w-full rounded-2xl" />
              </div>
            ) : (
              <>
                {/* 余额 + 兑换 */}
                <section className="overflow-hidden rounded-2xl border border-[var(--gold)]/25 bg-gradient-to-br from-[var(--gold)]/18 via-background to-background shadow-sm">
                  <div className="flex items-end gap-x-3 px-5 py-3 sm:px-6">
                    <p className="pb-0.5 text-sm leading-none text-muted-foreground">当前剩余</p>
                    <p className="text-3xl font-semibold leading-none tracking-tight tabular-nums text-foreground">
                      {balance}
                    </p>
                    <p className="pb-0.5 text-sm leading-none text-muted-foreground">次</p>
                    <span className="mb-0.5 hidden h-3.5 w-px shrink-0 bg-[var(--gold)]/30 sm:block" aria-hidden />
                    <p className="min-w-0 flex-1 truncate pb-0.5 text-xs leading-none text-muted-foreground">
                      每次成功生成穿搭效果图消耗 1 次 · 文案建议不扣次
                    </p>
                    <span className="mb-px flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--gold)]/20 text-[var(--gold)]">
                      <Sparkles className="size-3.5" aria-hidden />
                    </span>
                  </div>

                  <div className="border-t border-[var(--gold)]/15 bg-background/70 px-5 py-4 sm:px-6">
                    <div className="mb-3 flex items-center gap-2">
                      <Ticket className="size-4 shrink-0 text-[var(--gold)]" aria-hidden />
                      <h2 className="text-sm font-semibold">兑换码加次</h2>
                      <p className="text-xs text-muted-foreground">输入兑换码即可增加探索次数</p>
                    </div>

                    <form onSubmit={onRedeem} className="flex gap-2">
                      <Input
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="输入兑换码"
                        autoComplete="off"
                        className="h-10 flex-1 rounded-xl border-border transition-colors hover:border-[var(--gold)] focus-visible:border-[var(--gold)] focus-visible:ring-[var(--gold)]/30"
                        required
                      />
                      <Button
                        type="submit"
                        className="h-10 shrink-0 rounded-xl border-transparent bg-[var(--gold)] px-5 text-background hover:bg-[var(--gold)]/90"
                        disabled={redeeming || !code.trim()}
                      >
                        {redeeming ? '兑换中…' : '兑换'}
                      </Button>
                    </form>

                    {redeemError && (
                      <p className="mt-2 text-xs text-destructive">{redeemError}</p>
                    )}
                    {redeemOk && (
                      <p className="mt-2 text-xs text-emerald-600">{redeemOk}</p>
                    )}
                  </div>
                </section>

                {/* 流水 */}
                <section className="rounded-2xl border bg-background shadow-sm">
                  <div className="flex items-baseline justify-between gap-3 border-b px-5 py-4 sm:px-6">
                    <h2 className="text-sm font-semibold">次数流水</h2>
                    <p className="text-xs text-muted-foreground">最近 50 条</p>
                  </div>

                  {ledger.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-muted-foreground sm:px-6">
                      暂无流水
                    </p>
                  ) : (
                    <ul>
                      {ledger.map((row, index) => (
                        <li
                          key={row.id}
                          className={cn(
                            'flex items-center justify-between gap-4 px-5 py-3.5 sm:px-6',
                            index < ledger.length - 1 && 'border-b border-border/50'
                          )}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{row.reasonLabel}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {formatTime(row.createdAt)}
                            </p>
                          </div>
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums',
                              row.delta > 0
                                ? 'bg-emerald-500/10 text-emerald-700'
                                : 'bg-muted text-foreground'
                            )}
                          >
                            {row.delta > 0 ? `+${row.delta}` : row.delta}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
