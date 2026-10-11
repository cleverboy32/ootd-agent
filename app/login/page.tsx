"use client";

import { Suspense, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  fetchSecurityQuestions,
  login,
  register as registerAccount,
  resetPasswordByQuestions,
  resetPasswordByRecovery,
} from '@/lib/api/auth';
import { LOGO_SRC, withBasePath } from '@/lib/utils';

/** 只允许站内相对路径，防开放重定向 */
function safeRedirect(target: string | null): string {
  if (target && target.startsWith('/') && !target.startsWith('//')) return target;
  return '/';
}

/** 整页跳转：根布局的 AccessProvider 与内存 store 必须按新身份重新初始化，客户端路由做不到 */
function enterApp(redirect: string): void {
  window.location.assign(withBasePath(redirect));
}

const labelClass = 'block text-sm font-medium text-foreground mb-1.5';

function LoginTab({ redirect }: { redirect: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setPending(true);
    try {
      await login(username, password);
      enterApp(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后重试');
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="login-username" className={labelClass}>用户名</label>
        <Input
          id="login-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
      </div>
      <div>
        <label htmlFor="login-password" className={labelClass}>密码</label>
        <Input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? '登录中…' : '登录'}
      </Button>
    </form>
  );
}

function RegisterTab({ redirect }: { redirect: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setPending(true);
    try {
      await registerAccount(username, password, inviteCode);
      enterApp(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败，请稍后重试');
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="reg-username" className={labelClass}>用户名</label>
        <Input
          id="reg-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="3~20 位字母、数字、_ 或 -"
          autoComplete="username"
          required
        />
      </div>
      <div>
        <label htmlFor="reg-password" className={labelClass}>密码</label>
        <Input
          id="reg-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="至少 8 位，含字母和数字"
          autoComplete="new-password"
          required
        />
      </div>
      <div>
        <label htmlFor="reg-confirm" className={labelClass}>确认密码</label>
        <Input
          id="reg-confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>
      <div>
        <label htmlFor="reg-invite" className={labelClass}>邀请码</label>
        <Input
          id="reg-invite"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          placeholder="内测期间需邀请码注册"
          required
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? '注册中…' : '注册并登录'}
      </Button>
    </form>
  );
}

function ForgotTab({ redirect }: { redirect: string }) {
  const [username, setUsername] = useState('');
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [mode, setMode] = useState<'questions' | 'recovery'>('questions');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);

  async function loadQuestions(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setPending(true);
    try {
      const loaded = await fetchSecurityQuestions(username);
      if (loaded.length === 0) {
        setQuestions([]);
        setMode('recovery');
        setNotice('该账号未设置密保问题，请使用恢复码重置');
      } else {
        setQuestions(loaded);
        setAnswers(new Array(loaded.length).fill(''));
        setMode('questions');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败，请稍后重试');
    } finally {
      setPending(false);
    }
  }

  async function onReset(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setPending(true);
    try {
      if (mode === 'questions') {
        await resetPasswordByQuestions(username, answers, newPassword);
      } else {
        await resetPasswordByRecovery(username, recoveryCode, newPassword);
      }
      enterApp(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置失败，请稍后重试');
      setPending(false);
    }
  }

  // 第一步：输用户名取密保问题
  if (questions === null) {
    return (
      <form onSubmit={loadQuestions} className="space-y-4">
        <div>
          <label htmlFor="forgot-username" className={labelClass}>用户名</label>
          <Input
            id="forgot-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? '查询中…' : '下一步'}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={onReset} className="space-y-4">
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

      {mode === 'questions' && questions.length > 0 && (
        <div className="space-y-3">
          {questions.map((question, index) => (
            <div key={question}>
              <label className={labelClass} htmlFor={`answer-${index}`}>{question}</label>
              <Input
                id={`answer-${index}`}
                value={answers[index] ?? ''}
                onChange={(e) => {
                  const next = [...answers];
                  next[index] = e.target.value;
                  setAnswers(next);
                }}
                required
              />
            </div>
          ))}
        </div>
      )}

      {mode === 'recovery' && (
        <div>
          <label htmlFor="recovery-code" className={labelClass}>恢复码</label>
          <Input
            id="recovery-code"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            placeholder="XXXX-XXXX-XXXX"
            required
          />
        </div>
      )}

      <div>
        <label htmlFor="forgot-new" className={labelClass}>新密码</label>
        <Input
          id="forgot-new"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="至少 8 位，含字母和数字"
          autoComplete="new-password"
          required
        />
      </div>
      <div>
        <label htmlFor="forgot-confirm" className={labelClass}>确认新密码</label>
        <Input
          id="forgot-confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? '重置中…' : '重置密码并登录'}
      </Button>

      {questions.length > 0 && (
        <button
          type="button"
          className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => setMode(mode === 'questions' ? 'recovery' : 'questions')}
        >
          {mode === 'questions' ? '密保答案忘了？使用恢复码' : '返回密保问题'}
        </button>
      )}
    </form>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  const redirect = safeRedirect(searchParams.get('redirect'));

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Image src={LOGO_SRC} alt="Fashion AI Logo" width={32} height={32} className="rounded-md" />
          <span className="font-semibold text-xl tracking-tight">Fashion AI</span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>账号</CardTitle>
            <CardDescription>登录后同步你的衣橱、档案与搭配记录</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="login">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="login">登录</TabsTrigger>
                <TabsTrigger value="register">注册</TabsTrigger>
                <TabsTrigger value="forgot">忘记密码</TabsTrigger>
              </TabsList>
              <TabsContent value="login" className="pt-4">
                <LoginTab redirect={redirect} />
              </TabsContent>
              <TabsContent value="register" className="pt-4">
                <RegisterTab redirect={redirect} />
              </TabsContent>
              <TabsContent value="forgot" className="pt-4">
                <ForgotTab redirect={redirect} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}
