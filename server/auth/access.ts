export const ACCESS_COOKIE_NAME = 'ootd-access';
export const ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function getSessionSecret(): string {
  const secret = process.env.ACCESS_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('ACCESS_SESSION_SECRET must contain at least 32 characters.');
  }
  return secret;
}

async function hmac(payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getSessionSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

async function verifyHmac(payload: string, signature: Uint8Array): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getSessionSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const signatureBuffer = Uint8Array.from(signature).buffer;
  return crypto.subtle.verify('HMAC', key, signatureBuffer, encoder.encode(payload));
}

export function isAccessConfigured(): boolean {
  const secret = process.env.ACCESS_SESSION_SECRET?.trim();
  return Boolean(
    process.env.ACCESS_CODE?.trim() &&
      secret &&
      secret.length >= 32 &&
      process.env.OWNER_CLIENT_ID?.trim()
  );
}

export function getOwnerClientId(): string {
  const ownerClientId = process.env.OWNER_CLIENT_ID?.trim();
  if (!ownerClientId) throw new Error('OWNER_CLIENT_ID is missing.');
  return ownerClientId;
}

export function isAccessCodeValid(candidate: string): boolean {
  const expected = process.env.ACCESS_CODE?.trim();
  if (!expected || candidate.length !== expected.length) return false;

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= candidate.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

export async function createAccessSessionToken(now = Date.now()): Promise<string> {
  const expiresAt = Math.floor(now / 1000) + ACCESS_COOKIE_MAX_AGE_SECONDS;
  const payload = `v1.${expiresAt}`;
  const signature = await hmac(payload);
  return `${payload}.${toBase64Url(signature)}`;
}

export async function verifyAccessSessionToken(
  token: string | undefined,
  now = Date.now()
): Promise<boolean> {
  if (!token || !isAccessConfigured()) return false;

  const [version, expiresRaw, signatureRaw, ...rest] = token.split('.');
  if (version !== 'v1' || !expiresRaw || !signatureRaw || rest.length > 0) return false;

  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;

  try {
    return await verifyHmac(`${version}.${expiresRaw}`, fromBase64Url(signatureRaw));
  } catch {
    return false;
  }
}

export function isPublicReadRequest(pathname: string, method: string): boolean {
  if (method !== 'GET') return false;

  return (
    pathname === '/api/conversations' ||
    /^\/api\/conversations\/[^/]+\/messages$/.test(pathname) ||
    pathname === '/api/wardrobe' ||
    /^\/api\/wardrobe\/[^/]+$/.test(pathname) ||
    /^\/api\/clients\/[^/]+$/.test(pathname)
  );
}
