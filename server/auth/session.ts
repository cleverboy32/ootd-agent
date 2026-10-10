/**
 * 用户 session 票据：无状态 HMAC 签名 cookie（edge 兼容，proxy 可用）。
 * payload：v1.{userId}.{sessionVersion}.{expiresAt}（秒级时间戳）+ 签名。
 * 吊销手段：User.sessionVersion +1 使旧票据失效（改密/重置时 bump）。
 */
import { fromBase64Url, hmacSign, hmacVerify, toBase64Url } from './webcrypto';

export const SESSION_COOKIE_NAME = 'ootd-session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const TOKEN_VERSION = 'v1';

export interface SessionPayload {
  userId: string;
  sessionVersion: number;
  /** 秒级 unix 时间戳 */
  expiresAt: number;
}

function getSessionSecret(): string {
  const secret = process.env.USER_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('USER_SESSION_SECRET must contain at least 32 characters.');
  }
  return secret;
}

export function isSessionConfigured(): boolean {
  const secret = process.env.USER_SESSION_SECRET?.trim();
  return Boolean(secret && secret.length >= 32);
}

export async function createSessionToken(
  userId: string,
  sessionVersion: number,
  now = Date.now()
): Promise<string> {
  const expiresAt = Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = `${TOKEN_VERSION}.${userId}.${sessionVersion}.${expiresAt}`;
  const signature = await hmacSign(payload, getSessionSecret());
  return `${payload}.${toBase64Url(signature)}`;
}

export async function verifySessionToken(
  token: string | undefined,
  now = Date.now()
): Promise<SessionPayload | null> {
  if (!token || !isSessionConfigured()) return null;

  const parts = token.split('.');
  // userId 为 cuid（不含 '.'），完整票据固定 5 段
  if (parts.length !== 5) return null;
  const [version, userId, versionRaw, expiresRaw, signatureRaw] = parts;
  if (version !== TOKEN_VERSION || !userId || !versionRaw || !expiresRaw || !signatureRaw) {
    return null;
  }

  const sessionVersion = Number(versionRaw);
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(sessionVersion) || sessionVersion < 0) return null;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return null;

  try {
    const payload = `${version}.${userId}.${versionRaw}.${expiresRaw}`;
    const ok = await hmacVerify(payload, fromBase64Url(signatureRaw), getSessionSecret());
    return ok ? { userId, sessionVersion, expiresAt } : null;
  } catch {
    return null;
  }
}
