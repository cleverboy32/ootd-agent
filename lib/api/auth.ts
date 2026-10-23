/**
 * 认证 API 客户端（/api/auth/*）。
 * 不走 apiClient：auth 接口不需要 X-Client-ID 头，401 也不触发登录页跳转。
 */
import { withBasePath } from '@/lib/utils';

export interface AuthUser {
  id: string;
  username: string;
}

export interface SessionState {
  authenticated: boolean;
  user?: AuthUser & { hasSecurityQuestions: boolean };
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `请求失败（${res.status}）`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(withBasePath(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseOrThrow<T>(res);
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const data = await post<{ user: AuthUser }>('/api/auth/login', { username, password });
  return data.user;
}

export async function register(
  username: string,
  password: string,
  inviteCode: string
): Promise<AuthUser> {
  const data = await post<{ user: AuthUser }>('/api/auth/register', {
    username,
    password,
    inviteCode,
  });
  return data.user;
}

export async function logout(): Promise<void> {
  await post('/api/auth/logout');
}

export async function fetchSession(): Promise<SessionState> {
  const res = await fetch(withBasePath('/api/auth/session'), {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  return parseOrThrow<SessionState>(res);
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await post('/api/auth/change-password', { oldPassword, newPassword });
}

export async function fetchSecurityQuestions(username: string): Promise<string[]> {
  const res = await fetch(
    withBasePath(`/api/auth/security-questions?username=${encodeURIComponent(username)}`),
    { credentials: 'same-origin' }
  );
  const data = await parseOrThrow<{ questions: string[] }>(res);
  return data.questions;
}

/** 登录态：拉取当前用户已设置的密保问题文本（不含答案） */
export async function fetchMySecurityQuestions(): Promise<{
  questions: string[];
  configured: boolean;
}> {
  const res = await fetch(withBasePath('/api/auth/security-questions'), {
    credentials: 'same-origin',
  });
  const data = await parseOrThrow<{ questions: string[]; configured?: boolean }>(res);
  const questions = Array.isArray(data.questions) ? data.questions : [];
  return {
    questions,
    configured: data.configured === true || questions.length > 0,
  };
}

export async function setSecurityQuestions(
  questions: { question: string; answer: string }[]
): Promise<void> {
  await post('/api/auth/security-questions', { questions });
}

export async function generateRecoveryCodes(): Promise<string[]> {
  const data = await post<{ codes: string[] }>('/api/auth/recovery-codes');
  return data.codes;
}

export async function resetPasswordByQuestions(
  username: string,
  answers: string[],
  newPassword: string
): Promise<void> {
  await post('/api/auth/reset-password', {
    username,
    method: 'questions',
    answers,
    newPassword,
  });
}

export async function resetPasswordByRecovery(
  username: string,
  recoveryCode: string,
  newPassword: string
): Promise<void> {
  await post('/api/auth/reset-password', {
    username,
    method: 'recovery',
    recoveryCode,
    newPassword,
  });
}
