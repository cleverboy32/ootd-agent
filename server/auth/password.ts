/**
 * scrypt 哈希与校验（Node runtime 专用，不可用于 edge/proxy）。
 * 复用于：登录密码、密保答案、恢复码。
 * 存储格式：scrypt:N:r:p:salt:hash（salt/hash 为 base64）。
 */
import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// promisify 推导的签名不含 options 参数，显式标注
const scryptAsync = promisify(nodeScrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

export async function hashSecret(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(plain, salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString('base64')}:${derived.toString('base64')}`;
}

/** 常量时间比较；格式非法一律返回 false */
export async function verifySecret(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = await scryptAsync(plain, salt, expected.length, { N: n, r, p });
  return timingSafeEqual(derived, expected);
}

/** 返回错误文案；校验通过返回 null */
export function validatePasswordStrength(plain: string): string | null {
  if (plain.length < 8) return '密码至少 8 位';
  if (plain.length > 72) return '密码最长 72 位';
  if (!/[a-zA-Z]/.test(plain) || !/[0-9]/.test(plain)) return '密码需同时包含字母和数字';
  return null;
}
