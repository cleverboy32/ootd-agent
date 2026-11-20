/**
 * 用服务端公钥密封密码（RSA-OAEP SHA-256）。
 * 线格式：enc1.<kid>.<base64>，与 server/auth/transportCrypto.ts 对应。
 */

export interface SealMaterial {
  kid: string;
  spki?: string;
  key?: CryptoKey;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function importSpki(spki: string): Promise<CryptoKey> {
  const bytes = base64ToBytes(spki);
  return crypto.subtle.importKey(
    'spki',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );
}

export async function sealSecret(plain: string, material: SealMaterial): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境无法加密密码，请通过 HTTPS 访问');
  }
  const key = material.key ?? (material.spki ? await importSpki(material.spki) : null);
  if (!key) throw new Error('缺少加密公钥');

  const encrypted = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    key,
    new TextEncoder().encode(plain)
  );
  return `enc1.${material.kid}.${bytesToBase64(new Uint8Array(encrypted))}`;
}
