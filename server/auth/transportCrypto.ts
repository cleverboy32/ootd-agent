/**
 * 登录凭证的传输加密（RSA-OAEP SHA-256）。
 * 浏览器提交 enc1.<kid>.<base64>，服务端用私钥解开后再做 scrypt 校验。
 * 未带 enc1. 前缀的字符串原样返回，方便既有 API 测试继续传明文。
 *
 * 私钥：AUTH_TRANSPORT_PRIVATE_KEY（PKCS#8 DER 的 base64，或 PEM）。
 * 未配置时使用进程内临时密钥；多实例部署必须配置同一把私钥，否则解密会失败。
 */
import {
  constants,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt,
  type KeyObject,
} from 'node:crypto';

const PREFIX = 'enc1.';
const GLOBAL_KEY = Symbol.for('ootd.auth.transportKey');

interface KeyMaterial {
  privateKey: KeyObject;
  kid: string;
  spki: string;
}

type GlobalWithKey = typeof globalThis & { [GLOBAL_KEY]?: KeyMaterial };

export interface TransportPublicKey {
  kid: string;
  alg: 'RSA-OAEP-256';
  spki: string;
}

export type UnsealResult =
  | { ok: true; value: string }
  | { ok: false; code: 'TRANSPORT_INVALID' | 'TRANSPORT_KEY_MISMATCH'; error: string };

function loadPrivateKey(): KeyObject {
  const raw = process.env.AUTH_TRANSPORT_PRIVATE_KEY?.trim();
  if (!raw) {
    return generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  }
  if (raw.includes('BEGIN')) {
    return createPrivateKey({ key: raw.replace(/\\n/g, '\n'), format: 'pem', type: 'pkcs8' });
  }
  return createPrivateKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'pkcs8' });
}

function material(): KeyMaterial {
  const holder = globalThis as GlobalWithKey;
  const existing = holder[GLOBAL_KEY];
  if (existing) return existing;

  const fromEnv = Boolean(process.env.AUTH_TRANSPORT_PRIVATE_KEY?.trim());
  const privateKey = loadPrivateKey();
  const spkiDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const created: KeyMaterial = {
    privateKey,
    kid: createHash('sha256').update(spkiDer).digest('hex').slice(0, 16),
    spki: Buffer.from(spkiDer).toString('base64'),
  };
  holder[GLOBAL_KEY] = created;
  if (!fromEnv) {
    console.warn(
      '[AUTH_TRANSPORT] AUTH_TRANSPORT_PRIVATE_KEY 未配置，使用进程内临时密钥。多实例部署时登录解密会失败。'
    );
  }
  return created;
}

export function resetTransportCryptoForTests(): void {
  delete (globalThis as GlobalWithKey)[GLOBAL_KEY];
}

export function getTransportPublicKey(): TransportPublicKey {
  const current = material();
  return { kid: current.kid, alg: 'RSA-OAEP-256', spki: current.spki };
}

/** 解开浏览器密封的字段。非 enc1. 载荷按明文透传。 */
export function unsealSecret(raw: string): UnsealResult {
  if (!raw.startsWith(PREFIX)) return { ok: true, value: raw };

  const rest = raw.slice(PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot <= 0 || dot === rest.length - 1) {
    return { ok: false, code: 'TRANSPORT_INVALID', error: '登录参数无法解密，请重试' };
  }

  const kid = rest.slice(0, dot);
  const current = material();
  if (kid !== current.kid) {
    return { ok: false, code: 'TRANSPORT_KEY_MISMATCH', error: '加密密钥已更新，请重试' };
  }

  try {
    const plain = privateDecrypt(
      {
        key: current.privateKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(rest.slice(dot + 1), 'base64')
    );
    return { ok: true, value: plain.toString('utf8') };
  } catch {
    return { ok: false, code: 'TRANSPORT_INVALID', error: '登录参数无法解密，请重试' };
  }
}
