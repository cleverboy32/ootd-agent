'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Ticket } from 'lucide-react';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchSession } from '@/lib/api/auth';
import {
  fetchCredits,
  redeemCode,
  type CreditLedgerItem,
} from '@/lib/api/billing';

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
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<CreditLedgerItem[]>([]);
  const [code, setCode] = useState('');
  const [redeemError, setRedeemError] = useState('');
  const [redeemOk, setRedeemOk] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSession()
      .then((session) => {
        if (!session.authenticated || !session.user) {
          router.push('/login?redirect=/settings/credits');
          return null;
        }
        return fetchCredits(50);
      })
      .then((data) => {
        if (cancelled || !data) return;
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
  }, [router]);

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
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
        <div className="mx-auto max-w-lg space-y-5">

          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>当前剩余</CardDescription>
                  <CardTitle className="text-4xl font-semibold tracking-tight tabular-nums">
                    {balance}
                    <span className="ml-2 text-base font-normal text-muted-foreground">次</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  每次成功生成穿搭效果图消耗 1 次。文案建议不扣次。
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Ticket className="h-4 w-4" />
                    兑换码加次
                  </CardTitle>
                  <CardDescription>输入兑换码即可增加探索次数</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={onRedeem} className="flex flex-col gap-3 sm:flex-row">
                    <Input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="输入兑换码"
                      autoComplete="off"
                      className="sm:flex-1"
                      required
                    />
                    <Button type="submit" disabled={redeeming || !code.trim()}>
                      {redeeming ? '兑换中…' : '兑换'}
                    </Button>
                  </form>
                  {redeemError && (
                    <p className="mt-2 text-sm text-destructive">{redeemError}</p>
                  )}
                  {redeemOk && (
                    <p className="mt-2 text-sm text-emerald-600">{redeemOk}</p>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    需要人工充值？请联系客服并说明你的账号用户名。
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">次数流水</CardTitle>
                  <CardDescription>最近 50 条变动</CardDescription>
                </CardHeader>
                <CardContent>
                  {ledger.length === 0 ? (
                    <p className="text-sm text-muted-foreground">暂无流水</p>
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {ledger.map((row) => (
                        <li
                          key={row.id}
                          className="flex items-center justify-between gap-3 py-2.5 text-sm"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium">{row.reasonLabel}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatTime(row.createdAt)}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 tabular-nums font-medium ${
                              row.delta > 0 ? 'text-emerald-600' : 'text-foreground'
                            }`}
                          >
                            {row.delta > 0 ? `+${row.delta}` : row.delta}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
        </main>
      </div>
    </div>
  );
}
