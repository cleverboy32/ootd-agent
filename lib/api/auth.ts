/**
 * 认证 API 客户端（/api/auth/*）。
 * 不走 apiClient：auth 接口靠 session cookie，401 也不触发登录页跳转。
 * session 走 zustand（store/session），避免各模块重复打 /api/auth/session。
 */
import { sealSecret } from '@/lib/auth/sealSecret';
import { withBasePath } from '@/lib/utils';
import { useSessionStore, type SessionSnapshot } from '@/store/session';

export interface AuthUser {
  id: string;
  username: string;
}

export type SessionState = SessionSnapshot;

class AuthApiError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'AuthApiError';
    this.code = code;
  }
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw new AuthApiError(body?.error || `请求失败（${res.status}）`, body?.code);
  }
  return res.json() as Promise<T>;
}

interface CachedTransportKey {
  kid: string;
  key: CryptoKey;
}

let cachedTransportKey: CachedTransportKey | null = null;
let transportKeyPending: Promise<CachedTransportKey> | null = null;

function clearTransportKeyCache(): void {
  cachedTransportKey = null;
}

async function getTransportKey(): Promise<CachedTransportKey> {
  if (cachedTransportKey) return cachedTransportKey;
  if (!transportKeyPending) {
    transportKeyPending = fetchTransportKey().finally(() => {
      transportKeyPending = null;
    });
  }
  return transportKeyPending;
}

async function fetchTransportKey(): Promise<CachedTransportKey> {
  if (!globalThis.crypto?.subtle) {
    throw new AuthApiError('当前环境无法加密密码，请通过 HTTPS 访问');
  }
  const res = await fetch(withBasePath('/api/auth/transport-key'), { credentials: 'same-origin' });
  const data = await parseOrThrow<{ kid?: unknown; spki?: unknown }>(res);
  if (typeof data.kid !== 'string' || typeof data.spki !== 'string') {
    throw new AuthApiError('无法获取加密密钥');
  }
  const binary = atob(data.spki);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'spki',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );
  cachedTransportKey = { kid: data.kid, key };
  return cachedTransportKey;
}

/** 密钥轮换后服务端会返回 TRANSPORT_KEY_MISMATCH，清缓存重试一次。 */
async function withTransport<T>(fn: (material: CachedTransportKey) => Promise<T>): Promise<T> {
  try {
    return await fn(await getTransportKey());
  } catch (error) {
    if (error instanceof AuthApiError && error.code === 'TRANSPORT_KEY_MISMATCH') {
      clearTransportKeyCache();
      return fn(await getTransportKey());
    }
    throw error;
  }
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
  const data = await withTransport(async (material) =>
    post<{ user: AuthUser }>('/api/auth/login', {
      username,
      password: await sealSecret(password, material),
    })
  );
  return data.user;
}

export async function register(username: string, password: string): Promise<AuthUser> {
  const data = await withTransport(async (material) =>
    post<{ user: AuthUser }>('/api/auth/register', {
      username,
      password: await sealSecret(password, material),
    })
  );
  return data.user;
}

export async function logout(): Promise<void> {
  await post('/api/auth/logout');
  useSessionStore.getState().clearSession();
}

/** 读 zustand 中的 session；未就绪则拉一次并写入 store（并发合并） */
export async function fetchSession(options?: { bust?: boolean }): Promise<SessionState> {
  return useSessionStore.getState().ensureSession(options);
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await withTransport(async (material) =>
    post('/api/auth/change-password', {
      oldPassword: await sealSecret(oldPassword, material),
      newPassword: await sealSecret(newPassword, material),
    })
  );
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
  await withTransport(async (material) =>
    post('/api/auth/security-questions', {
      questions: await Promise.all(
        questions.map(async (item) => ({
          question: item.question,
          answer: await sealSecret(item.answer, material),
        }))
      ),
    })
  );
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
  await withTransport(async (material) =>
    post('/api/auth/reset-password', {
      username,
      method: 'questions',
      answers: await Promise.all(answers.map((answer) => sealSecret(answer, material))),
      newPassword: await sealSecret(newPassword, material),
    })
  );
}

export async function resetPasswordByRecovery(
  username: string,
  recoveryCode: string,
  newPassword: string
): Promise<void> {
  await withTransport(async (material) =>
    post('/api/auth/reset-password', {
      username,
      method: 'recovery',
      recoveryCode: await sealSecret(recoveryCode, material),
      newPassword: await sealSecret(newPassword, material),
    })
  );
}
