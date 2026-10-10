/**
 * Edge 兼容的 base64url + HMAC-SHA256 工具。
 * 供签名票据类模块复用（用户 session 等）；proxy（edge runtime）可用。
 */

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function hmacSign(payload: string, secret: string): Promise<Uint8Array> {
  const key = await importHmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

export async function hmacVerify(
  payload: string,
  signature: Uint8Array,
  secret: string
): Promise<boolean> {
  const key = await importHmacKey(secret);
  const signatureBuffer = Uint8Array.from(signature).buffer;
  return crypto.subtle.verify('HMAC', key, signatureBuffer, encoder.encode(payload));
}
