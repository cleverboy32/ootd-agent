"use client";

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  changePassword,
  fetchMySecurityQuestions,
  fetchSession,
  generateRecoveryCodes,
  setSecurityQuestions,
  type AuthUser,
} from '@/lib/api/auth';

/** 已设置答案的密文占位（非真实答案；提交时若未改动则传空串以保留原哈希） */
const ANSWER_MASK = '••••••••';

const labelClass = 'block text-sm font-medium text-foreground mb-1.5';

function ChangePasswordCard() {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setOk(false);
    if (newPassword !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setPending(true);
    try {
      await changePassword(oldPassword, newPassword);
      setOk(true);
      setOldPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改失败，请稍后重试');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">修改密码</CardTitle>
        <CardDescription>修改成功后，其他设备的登录状态将全部失效</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4 max-w-sm">
          <div>
            <label htmlFor="old-password" className={labelClass}>原密码</label>
            <Input
              id="old-password"
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div>
            <label htmlFor="new-password" className={labelClass}>新密码</label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="至少 8 位，含字母和数字"
              autoComplete="new-password"
              required
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className={labelClass}>确认新密码</label>
            <Input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {ok && <p className="text-sm text-green-600">密码已更新</p>}
          <Button type="submit" disabled={pending}>
            {pending ? '提交中…' : '更新密码'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

interface QA {
  question: string;
  answer: string;
}

function SecurityQuestionsCard() {
  const [items, setItems] = useState<QA[]>([
    { question: '', answer: '' },
    { question: '', answer: '' },
  ]);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    fetchMySecurityQuestions()
      .then(({ questions, configured: hasConfigured }) => {
        if (questions.length >= 2) {
          setItems(
            questions.map((question) => ({
              question,
              answer: ANSWER_MASK,
            })),
          );
          setConfigured(true);
        } else {
          setConfigured(hasConfigured);
        }
      })
      .catch(() => {
        // 加载失败仍允许空白表单新建
      })
      .finally(() => setLoading(false));
  }, []);

  function updateItem(index: number, patch: Partial<QA>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setOk(false);
    setPending(true);
    try {
      const payload = items.map((item) => ({
        question: item.question,
        // 未改动的密文占位 → 空串，服务端保留原哈希
        answer: item.answer === ANSWER_MASK ? '' : item.answer,
      }));
      await setSecurityQuestions(payload);
      setOk(true);
      setConfigured(true);
      setItems((prev) =>
        prev.map((item) => ({
          question: item.question,
          answer: ANSWER_MASK,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请稍后重试');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">密保问题</CardTitle>
        <CardDescription>
          忘记密码时通过密保问题重置。设置 2~3 组；答案不区分大小写与全半角。
          {configured
            ? ' 已设置：答案以密文显示，不改动可直接保存；修改请重新输入答案。'
            : ' 请好记且不易被猜到。'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4 max-w-lg">
            {configured && (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                当前已设置 {items.length} 组密保问题
              </p>
            )}
            {items.map((item, index) => (
              <div key={index} className="flex gap-3 items-start">
                <div className="flex-1">
                  <label className={labelClass}>问题 {index + 1}</label>
                  <Input
                    value={item.question}
                    onChange={(e) => updateItem(index, { question: e.target.value })}
                    placeholder="例如：我小学的名字是什么"
                    required
                  />
                </div>
                <div className="flex-1">
                  <label className={labelClass}>答案</label>
                  <Input
                    type="password"
                    autoComplete="off"
                    value={item.answer}
                    onFocus={() => {
                      if (item.answer === ANSWER_MASK) {
                        updateItem(index, { answer: '' });
                      }
                    }}
                    onChange={(e) => updateItem(index, { answer: e.target.value })}
                    onBlur={() => {
                      if (configured && item.answer.trim() === '') {
                        updateItem(index, { answer: ANSWER_MASK });
                      }
                    }}
                    placeholder={configured ? ANSWER_MASK : '请输入答案'}
                    required={!configured}
                  />
                </div>
                {items.length > 2 && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-7"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                  >
                    删除
                  </Button>
                )}
              </div>
            ))}
            {items.length < 3 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setItems((prev) => [...prev, { question: '', answer: '' }])}
              >
                再加一个问题
              </Button>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {ok && <p className="text-sm text-green-600">密保问题已保存</p>}
            <div>
              <Button type="submit" disabled={pending}>
                {pending ? '保存中…' : configured ? '更新密保问题' : '保存密保问题'}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function RecoveryCodesCard() {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function onGenerate() {
    setError('');
    setPending(true);
    try {
      const generated = await generateRecoveryCodes();
      setCodes(generated);
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请稍后重试');
    } finally {
      setPending(false);
    }
  }

  async function onCopy() {
    if (!codes) return;
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">恢复码</CardTitle>
        <CardDescription>
          密保答案也忘了时的最后找回手段。生成后请立即保存；重新生成会使旧码全部作废
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive mb-3">{error}</p>}
        <Button onClick={onGenerate} disabled={pending} variant="outline">
          {pending ? '生成中…' : '生成新的恢复码'}
        </Button>

        <Dialog open={codes !== null} onOpenChange={(open) => !open && setCodes(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>请立即保存恢复码</DialogTitle>
              <DialogDescription>
                每个恢复码只能使用一次，关闭后将无法再次查看
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm py-2">
              {codes?.map((code) => (
                <div key={code} className="rounded bg-muted px-2 py-1 text-center">
                  {code}
                </div>
              ))}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={onCopy}>
                {copied ? '已复制' : '复制全部'}
              </Button>
              <Button onClick={() => setCodes(null)}>我已保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export default function SecuritySettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSession()
      .then((state) => {
        if (!state.authenticated || !state.user) {
          router.push('/login?redirect=/settings/security');
          return;
        }
        setUser(state.user);
        setLoading(false);
      })
      .catch(() => {
        router.push('/login?redirect=/settings/security');
      });
  }, [router]);

  return (
    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      <AppSidebar activeSection="profile" />

      <div className="flex flex-col">
        <header className="flex h-14 items-center gap-2 border-b px-4 lg:h-15 lg:px-6">
          <Link
            href="/profile"
            aria-label="返回我的档案"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="text-lg font-semibold">安全中心</h1>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {loading ? (
            <div className="space-y-4 w-full">
              <Skeleton className="h-40 w-full rounded-xl" />
              <Skeleton className="h-48 w-full rounded-xl" />
            </div>
          ) : user ? (
            <div className="space-y-6 w-full max-w-3xl">
              <p className="text-sm text-muted-foreground">
                当前账号：<span className="font-medium text-foreground">{user.username}</span>
              </p>
              <ChangePasswordCard />
              <SecurityQuestionsCard />
              <RecoveryCodesCard />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
