"use client";

import { Suspense, useState, type FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  fetchSecurityQuestions,
  login,
  register as registerAccount,
  resetPasswordByQuestions,
  resetPasswordByRecovery,
} from '@/lib/api/auth';
import { cn, LOGO_SRC, withBasePath } from '@/lib/utils';

/** 只允许站内相对路径，防开放重定向 */
function safeRedirect(target: string | null): string {
  if (target && target.startsWith('/') && !target.startsWith('//')) return target;
  return '/';
}

/** 整页跳转：根布局的 AccessProvider 与内存 store 必须按新身份重新初始化，客户端路由做不到 */
function enterApp(redirect: string): void {
  window.location.assign(withBasePath(redirect));
}

const fieldClass = 'space-y-1.5';
const labelClass = 'block text-sm font-medium text-foreground/80';
const inputClass =
  'h-11 rounded-xl bg-background px-3.5 text-sm shadow-none border-border transition-colors hover:border-[var(--gold)] focus-visible:border-[var(--gold)] focus-visible:ring-[var(--gold)]/30';

function fieldInputClass(hasError: boolean): string {
  return cn(
    inputClass,
    hasError &&
      'border-destructive hover:border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30',
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {message}
    </p>
  );
}

function LoginFields({
  formId,
  redirect,
  onForgot,
  onPendingChange,
}: {
  formId: string;
  redirect: string;
  onForgot: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    onPendingChange(true);
    try {
      await login(username, password);
      enterApp(redirect);
    } catch (err) {
      const message = err instanceof Error ? err.message : '登录失败，请稍后重试';
      // 凭据错误挂在密码框；锁定等整单提示也挂密码框，避免漂在表单底部
      setFieldErrors({ password: message });
      onPendingChange(false);
    }
  }

  return (
    <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className={fieldClass}>
        <label htmlFor="login-username" className={labelClass}>用户名</label>
        <Input
          id="login-username"
          className={fieldInputClass(Boolean(fieldErrors.username))}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            if (fieldErrors.username) setFieldErrors((prev) => ({ ...prev, username: undefined }));
          }}
          autoComplete="username"
          aria-invalid={Boolean(fieldErrors.username)}
          required
        />
        <FieldError message={fieldErrors.username} />
      </div>
      <div className={fieldClass}>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="login-password" className={labelClass}>密码</label>
          <button
            type="button"
            onClick={onForgot}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            忘记密码？
          </button>
        </div>
        <Input
          id="login-password"
          className={fieldInputClass(Boolean(fieldErrors.password))}
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
          }}
          autoComplete="current-password"
          aria-invalid={Boolean(fieldErrors.password)}
          required
        />
        <FieldError message={fieldErrors.password} />
      </div>
    </form>
  );
}

type RegisterField = 'username' | 'password' | 'confirm' | 'invite';

function mapRegisterError(message: string): Partial<Record<RegisterField, string>> {
  if (message.includes('用户名') || message.includes('已被占用')) return { username: message };
  if (message.includes('邀请码')) return { invite: message };
  if (message.includes('密码')) return { password: message };
  return { username: message };
}

function RegisterFields({
  formId,
  redirect,
  onPendingChange,
}: {
  formId: string;
  redirect: string;
  onPendingChange: (pending: boolean) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RegisterField, string>>>({});

  function clearField(field: RegisterField) {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    if (password !== confirm) {
      setFieldErrors({ confirm: '两次输入的密码不一致' });
      return;
    }
    onPendingChange(true);
    try {
      await registerAccount(username, password, inviteCode);
      enterApp(redirect);
    } catch (err) {
      const message = err instanceof Error ? err.message : '注册失败，请稍后重试';
      setFieldErrors(mapRegisterError(message));
      onPendingChange(false);
    }
  }

  return (
    <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className={fieldClass}>
        <label htmlFor="reg-username" className={labelClass}>用户名</label>
        <Input
          id="reg-username"
          className={fieldInputClass(Boolean(fieldErrors.username))}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            clearField('username');
          }}
          placeholder="3~20 位字母、数字、_ 或 -"
          autoComplete="username"
          aria-invalid={Boolean(fieldErrors.username)}
          required
        />
        <FieldError message={fieldErrors.username} />
      </div>
      <div className={fieldClass}>
        <label htmlFor="reg-password" className={labelClass}>密码</label>
        <Input
          id="reg-password"
          className={fieldInputClass(Boolean(fieldErrors.password))}
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            clearField('password');
          }}
          placeholder="至少 8 位，含字母和数字"
          autoComplete="new-password"
          aria-invalid={Boolean(fieldErrors.password)}
          required
        />
        <FieldError message={fieldErrors.password} />
      </div>
      <div className={fieldClass}>
        <label htmlFor="reg-confirm" className={labelClass}>确认密码</label>
        <Input
          id="reg-confirm"
          className={fieldInputClass(Boolean(fieldErrors.confirm))}
          type="password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            clearField('confirm');
          }}
          autoComplete="new-password"
          aria-invalid={Boolean(fieldErrors.confirm)}
          required
        />
        <FieldError message={fieldErrors.confirm} />
      </div>
      <div className={fieldClass}>
        <label htmlFor="reg-invite" className={labelClass}>邀请码</label>
        <Input
          id="reg-invite"
          className={fieldInputClass(Boolean(fieldErrors.invite))}
          value={inviteCode}
          onChange={(e) => {
            setInviteCode(e.target.value);
            clearField('invite');
          }}
          placeholder="内测期间需邀请码注册"
          aria-invalid={Boolean(fieldErrors.invite)}
          required
        />
        <FieldError message={fieldErrors.invite} />
      </div>
    </form>
  );
}

function ForgotPanel({
  formId,
  redirect,
  onBack,
  onPendingChange,
  onActionLabelChange,
}: {
  formId: string;
  redirect: string;
  onBack: () => void;
  onPendingChange: (pending: boolean) => void;
  onActionLabelChange: (label: string) => void;
}) {
  const [username, setUsername] = useState('');
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [mode, setMode] = useState<'questions' | 'recovery'>('questions');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    username?: string;
    answers?: string;
    recovery?: string;
    password?: string;
    confirm?: string;
  }>({});
  const [notice, setNotice] = useState('');

  async function loadQuestions(e: FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setNotice('');
    onPendingChange(true);
    try {
      const loaded = await fetchSecurityQuestions(username);
      if (loaded.length === 0) {
        setQuestions([]);
        setMode('recovery');
        setNotice('该账号未设置密保问题，请使用恢复码重置');
        onActionLabelChange('重置密码并登录');
      } else {
        setQuestions(loaded);
        setAnswers(new Array(loaded.length).fill(''));
        setMode('questions');
        onActionLabelChange('重置密码并登录');
      }
    } catch (err) {
      setFieldErrors({
        username: err instanceof Error ? err.message : '加载失败，请稍后重试',
      });
    } finally {
      onPendingChange(false);
    }
  }

  async function onReset(e: FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    if (newPassword !== confirm) {
      setFieldErrors({ confirm: '两次输入的密码不一致' });
      return;
    }
    onPendingChange(true);
    try {
      if (mode === 'questions') {
        await resetPasswordByQuestions(username, answers, newPassword);
      } else {
        await resetPasswordByRecovery(username, recoveryCode, newPassword);
      }
      enterApp(redirect);
    } catch (err) {
      const message = err instanceof Error ? err.message : '重置失败，请稍后重试';
      if (message.includes('恢复码') || message.includes('请输入恢复码')) {
        setFieldErrors({ recovery: message });
      } else if (message.includes('密码')) {
        setFieldErrors({ password: message });
      } else if (mode === 'recovery') {
        setFieldErrors({ recovery: message });
      } else {
        setFieldErrors({ answers: message });
      }
      onPendingChange(false);
    }
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        返回登录
      </button>

      {questions === null ? (
        <form id={formId} onSubmit={loadQuestions} className="flex flex-col gap-4">
          <div className={fieldClass}>
            <label htmlFor="forgot-username" className={labelClass}>用户名</label>
            <Input
              id="forgot-username"
              className={fieldInputClass(Boolean(fieldErrors.username))}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (fieldErrors.username) setFieldErrors((prev) => ({ ...prev, username: undefined }));
              }}
              aria-invalid={Boolean(fieldErrors.username)}
              required
            />
            <FieldError message={fieldErrors.username} />
          </div>
        </form>
      ) : (
        <form id={formId} onSubmit={onReset} className="flex flex-col gap-4">
          {notice && (
            <p className="rounded-lg bg-muted/80 px-3 py-2 text-sm text-muted-foreground">
              {notice}
            </p>
          )}

          {mode === 'questions' && questions.length > 0 && (
            <div className="space-y-4">
              {questions.map((question, index) => (
                <div key={question} className={fieldClass}>
                  <label className={labelClass} htmlFor={`answer-${index}`}>{question}</label>
                  <Input
                    id={`answer-${index}`}
                    className={fieldInputClass(Boolean(fieldErrors.answers) && index === 0)}
                    value={answers[index] ?? ''}
                    onChange={(e) => {
                      const next = [...answers];
                      next[index] = e.target.value;
                      setAnswers(next);
                      if (fieldErrors.answers) {
                        setFieldErrors((prev) => ({ ...prev, answers: undefined }));
                      }
                    }}
                    aria-invalid={Boolean(fieldErrors.answers) && index === 0}
                    required
                  />
                  {index === 0 && <FieldError message={fieldErrors.answers} />}
                </div>
              ))}
            </div>
          )}

          {mode === 'recovery' && (
            <div className={fieldClass}>
              <label htmlFor="recovery-code" className={labelClass}>恢复码</label>
              <Input
                id="recovery-code"
                className={fieldInputClass(Boolean(fieldErrors.recovery))}
                value={recoveryCode}
                onChange={(e) => {
                  setRecoveryCode(e.target.value);
                  if (fieldErrors.recovery) {
                    setFieldErrors((prev) => ({ ...prev, recovery: undefined }));
                  }
                }}
                placeholder="XXXX-XXXX-XXXX"
                aria-invalid={Boolean(fieldErrors.recovery)}
                required
              />
              <FieldError message={fieldErrors.recovery} />
            </div>
          )}

          <div className={fieldClass}>
            <label htmlFor="forgot-new" className={labelClass}>新密码</label>
            <Input
              id="forgot-new"
              className={fieldInputClass(Boolean(fieldErrors.password))}
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                if (fieldErrors.password) {
                  setFieldErrors((prev) => ({ ...prev, password: undefined }));
                }
              }}
              placeholder="至少 8 位，含字母和数字"
              autoComplete="new-password"
              aria-invalid={Boolean(fieldErrors.password)}
              required
            />
            <FieldError message={fieldErrors.password} />
          </div>
          <div className={fieldClass}>
            <label htmlFor="forgot-confirm" className={labelClass}>确认新密码</label>
            <Input
              id="forgot-confirm"
              className={fieldInputClass(Boolean(fieldErrors.confirm))}
              type="password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                if (fieldErrors.confirm) {
                  setFieldErrors((prev) => ({ ...prev, confirm: undefined }));
                }
              }}
              autoComplete="new-password"
              aria-invalid={Boolean(fieldErrors.confirm)}
              required
            />
            <FieldError message={fieldErrors.confirm} />
          </div>

          {questions.length > 0 && (
            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setMode(mode === 'questions' ? 'recovery' : 'questions')}
            >
              {mode === 'questions' ? '密保答案忘了？使用恢复码' : '返回密保问题'}
            </button>
          )}
        </form>
      )}
    </div>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  const redirect = safeRedirect(searchParams.get('redirect'));
  const [panel, setPanel] = useState<'login' | 'register' | 'forgot'>('login');
  const [pending, setPending] = useState(false);
  const [forgotActionLabel, setForgotActionLabel] = useState('下一步');

  const loginFormId = 'login-form';
  const registerFormId = 'register-form';
  const forgotFormId = 'forgot-form';

  const title =
    panel === 'forgot'
      ? '重置密码'
      : panel === 'register'
        ? '创建账号'
        : '欢迎回来';
  const description =
    panel === 'forgot'
      ? '通过密保问题或恢复码设置新密码'
      : panel === 'register'
        ? '内测邀请制，注册后即可同步衣橱与搭配'
        : '登录后同步你的衣橱、档案与搭配记录';

  const activeFormId =
    panel === 'forgot'
      ? forgotFormId
      : panel === 'register'
        ? registerFormId
        : loginFormId;

  const actionLabel =
    panel === 'forgot'
      ? (pending ? (forgotActionLabel === '下一步' ? '查询中…' : '重置中…') : forgotActionLabel)
      : panel === 'register'
        ? (pending ? '注册中…' : '注册并登录')
        : (pending ? '登录中…' : '登录');

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* 与主页侧栏一致的品牌顶栏 */}
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center border-b border-border/40 bg-background/80 px-4 backdrop-blur-sm lg:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Image
            src={LOGO_SRC}
            alt="Fashion AI Logo"
            width={28}
            height={28}
            className="rounded-md"
            priority
          />
          <span className="text-lg tracking-tight">Fashion AI</span>
        </Link>
      </header>

      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-10">
        {/* 品牌线稿背景：cover 铺满宽度（原先 contain 会左右留白） */}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <Image
            src={withBasePath('/brand-hero-gold.png')}
            alt=""
            fill
            priority
            quality={100}
            unoptimized
            sizes="200vw"
            className="object-cover object-center opacity-50 scale-[1.15] translate-x-[100px]"
          />
          {/* 仅在表单中心做很轻的可读性提亮，不罩整图 */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.28)_0%,rgba(255,255,255,0.08)_35%,transparent_60%)]" />
        </div>

        <div className="relative z-10 w-full max-w-[400px]">
          <div className="mb-6">
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
          </div>

          {panel === 'forgot' ? (
            <ForgotPanel
              formId={forgotFormId}
              redirect={redirect}
              onBack={() => {
                setPanel('login');
                setPending(false);
                setForgotActionLabel('下一步');
              }}
              onPendingChange={setPending}
              onActionLabelChange={setForgotActionLabel}
            />
          ) : panel === 'register' ? (
            <RegisterFields
              formId={registerFormId}
              redirect={redirect}
              onPendingChange={setPending}
            />
          ) : (
            <LoginFields
              formId={loginFormId}
              redirect={redirect}
              onForgot={() => {
                setPanel('forgot');
                setPending(false);
                setForgotActionLabel('下一步');
              }}
              onPendingChange={setPending}
            />
          )}

          <Button
            type="submit"
            form={activeFormId}
            variant="default"
            size="lg"
            className="mt-8 h-11 w-full rounded-xl"
            disabled={pending}
          >
            {actionLabel}
          </Button>

          {panel !== 'forgot' && (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {panel === 'login' ? (
                <>
                  还没有账号？{' '}
                  <button
                    type="button"
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                    onClick={() => {
                      setPanel('register');
                      setPending(false);
                    }}
                  >
                    注册
                  </button>
                </>
              ) : (
                <>
                  已有账号？{' '}
                  <button
                    type="button"
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                    onClick={() => {
                      setPanel('login');
                      setPending(false);
                    }}
                  >
                    登录
                  </button>
                </>
              )}
            </p>
          )}

          <p className="mt-4 text-center text-xs text-muted-foreground/80">
            登录即表示你同意合理使用本服务，生成内容仅供穿搭参考
          </p>
        </div>
      </main>
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
