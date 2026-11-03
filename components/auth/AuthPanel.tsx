'use client';

import { useState, type FormEvent } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  fetchSecurityQuestions,
  login,
  register as registerAccount,
  resetPasswordByQuestions,
  resetPasswordByRecovery,
} from '@/lib/api/auth';
import { navigateWithAuthBoot } from '@/lib/authBoot';
import { cn, withBasePath } from '@/lib/utils';

export type AuthPanelKind = 'login' | 'register' | 'forgot';

/** 只允许站内相对路径，防开放重定向 */
export function safeRedirect(target: string | null | undefined): string {
  if (target && target.startsWith('/') && !target.startsWith('//')) return target;
  return '/';
}

/** 整页跳转：根布局的 AccessProvider 与内存 store 必须按新身份重新初始化 */
export function enterApp(redirect: string): void {
  navigateWithAuthBoot(withBasePath(safeRedirect(redirect)), '正在进入…');
}

const fieldClass = 'space-y-1.5';
const labelClass = 'block text-sm font-medium text-foreground/80';
const inputClass =
  'h-11 rounded-xl bg-background px-3.5 text-sm shadow-none border-border transition-colors hover:border-[var(--gold)] focus-visible:border-[var(--gold)] focus-visible:ring-[var(--gold)]/30';

function fieldInputClass(hasError: boolean): string {
  return cn(
    inputClass,
    hasError &&
      'border-destructive hover:border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30'
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
  onForgot,
  onPendingChange,
  onAuthenticated,
}: {
  formId: string;
  onForgot: () => void;
  onPendingChange: (pending: boolean) => void;
  onAuthenticated: () => void;
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
      onAuthenticated();
    } catch (err) {
      const message = err instanceof Error ? err.message : '登录失败，请稍后重试';
      setFieldErrors({ password: message });
      onPendingChange(false);
    }
  }

  return (
    <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className={fieldClass}>
        <label htmlFor={`${formId}-username`} className={labelClass}>
          用户名
        </label>
        <Input
          id={`${formId}-username`}
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
          <label htmlFor={`${formId}-password`} className={labelClass}>
            密码
          </label>
          <button
            type="button"
            onClick={onForgot}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            忘记密码？
          </button>
        </div>
        <Input
          id={`${formId}-password`}
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

type RegisterField = 'username' | 'password' | 'confirm';

function mapRegisterError(message: string): Partial<Record<RegisterField, string>> {
  if (message.includes('用户名') || message.includes('已被占用')) return { username: message };
  if (message.includes('密码')) return { password: message };
  return { username: message };
}

function RegisterFields({
  formId,
  onPendingChange,
  onAuthenticated,
}: {
  formId: string;
  onPendingChange: (pending: boolean) => void;
  onAuthenticated: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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
      await registerAccount(username, password);
      onAuthenticated();
    } catch (err) {
      const message = err instanceof Error ? err.message : '注册失败，请稍后重试';
      setFieldErrors(mapRegisterError(message));
      onPendingChange(false);
    }
  }

  return (
    <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className={fieldClass}>
        <label htmlFor={`${formId}-username`} className={labelClass}>
          用户名
        </label>
        <Input
          id={`${formId}-username`}
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
        <label htmlFor={`${formId}-password`} className={labelClass}>
          密码
        </label>
        <Input
          id={`${formId}-password`}
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
        <label htmlFor={`${formId}-confirm`} className={labelClass}>
          确认密码
        </label>
        <Input
          id={`${formId}-confirm`}
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
    </form>
  );
}

function ForgotPanel({
  formId,
  onBack,
  onPendingChange,
  onActionLabelChange,
  onAuthenticated,
}: {
  formId: string;
  onBack: () => void;
  onPendingChange: (pending: boolean) => void;
  onActionLabelChange: (label: string) => void;
  onAuthenticated: () => void;
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
      onAuthenticated();
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
            <label htmlFor={`${formId}-username`} className={labelClass}>
              用户名
            </label>
            <Input
              id={`${formId}-username`}
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
            <p className="rounded-lg bg-muted/80 px-3 py-2 text-sm text-muted-foreground">{notice}</p>
          )}

          {mode === 'questions' && questions.length > 0 && (
            <div className="space-y-4">
              {questions.map((question, index) => (
                <div key={question} className={fieldClass}>
                  <label className={labelClass} htmlFor={`${formId}-answer-${index}`}>
                    {question}
                  </label>
                  <Input
                    id={`${formId}-answer-${index}`}
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
              <label htmlFor={`${formId}-recovery`} className={labelClass}>
                恢复码
              </label>
              <Input
                id={`${formId}-recovery`}
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
            <label htmlFor={`${formId}-new`} className={labelClass}>
              新密码
            </label>
            <Input
              id={`${formId}-new`}
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
            <label htmlFor={`${formId}-confirm`} className={labelClass}>
              确认新密码
            </label>
            <Input
              id={`${formId}-confirm`}
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

export type AuthPanelProps = {
  redirect: string;
  initialPanel?: AuthPanelKind;
  /** page=登录整页内容区；modal=弹窗内紧凑卡片 */
  variant?: 'page' | 'modal';
  onRequestClose?: () => void;
};

export function AuthPanel({
  redirect,
  initialPanel = 'login',
  variant = 'page',
}: AuthPanelProps) {
  const [panel, setPanel] = useState<AuthPanelKind>(initialPanel);
  const [pending, setPending] = useState(false);
  const [entering, setEntering] = useState(false);
  const [forgotActionLabel, setForgotActionLabel] = useState('下一步');
  const prefix = variant === 'modal' ? 'auth-modal' : 'auth-page';
  const loginFormId = `${prefix}-login-form`;
  const registerFormId = `${prefix}-register-form`;
  const forgotFormId = `${prefix}-forgot-form`;

  function handleAuthenticated() {
    setEntering(true);
    setPending(true);
    // 先让「登录成功」画出来，再跳转，过渡更顺
    window.setTimeout(() => {
      enterApp(redirect);
    }, 320);
  }

  const title = entering
    ? '登录成功'
    : panel === 'forgot'
      ? '重置密码'
      : panel === 'register'
        ? '创建账号'
        : '欢迎回来';
  const description = entering
    ? '正在进入，请稍候…'
    : panel === 'forgot'
      ? '通过密保问题或恢复码设置新密码'
      : panel === 'register'
        ? null
        : '登录后同步你的衣橱、档案与搭配记录';

  const activeFormId =
    panel === 'forgot' ? forgotFormId : panel === 'register' ? registerFormId : loginFormId;

  const actionLabel = entering
    ? '正在进入…'
    : panel === 'forgot'
      ? pending
        ? forgotActionLabel === '下一步'
          ? '查询中…'
          : '重置中…'
        : forgotActionLabel
      : panel === 'register'
        ? pending
          ? '注册中…'
          : '注册并登录'
        : pending
          ? '登录中…'
          : '登录';

  const headingTag = variant === 'modal' ? 'h2' : 'h1';

  return (
    <div className={cn('w-full', variant === 'page' ? 'max-w-[400px]' : 'max-w-none')}>
      <div className={cn('relative', panel === 'register' && !entering ? 'mb-12' : 'mb-6')}>
        {headingTag === 'h1' ? (
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        ) : (
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        )}
        {description && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
        {panel === 'register' && !entering && (
          <div
            role="status"
            className="pointer-events-none absolute left-0 top-full z-20 mt-2.5 w-max max-w-[min(100%,18rem)] rounded-full bg-[var(--gold)] px-3 py-1.5 text-xs text-background shadow-md"
          >
            <div className="flex items-center gap-1.5">
              <Sparkles className="size-3 shrink-0" aria-hidden />
              <p className="leading-none whitespace-nowrap">
                注册即赠送 <span className="font-semibold">5 积分</span>
              </p>
            </div>
            <span aria-hidden className="absolute -top-1 left-5 size-2 rotate-45 bg-[var(--gold)]" />
          </div>
        )}
      </div>

      {panel === 'forgot' ? (
        <ForgotPanel
          formId={forgotFormId}
          onBack={() => {
            setPanel('login');
            setPending(false);
            setForgotActionLabel('下一步');
          }}
          onPendingChange={setPending}
          onActionLabelChange={setForgotActionLabel}
          onAuthenticated={handleAuthenticated}
        />
      ) : panel === 'register' ? (
        <RegisterFields
          formId={registerFormId}
          onPendingChange={setPending}
          onAuthenticated={handleAuthenticated}
        />
      ) : (
        <LoginFields
          formId={loginFormId}
          onForgot={() => {
            setPanel('forgot');
            setPending(false);
            setForgotActionLabel('下一步');
          }}
          onPendingChange={setPending}
          onAuthenticated={handleAuthenticated}
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
  );
}
