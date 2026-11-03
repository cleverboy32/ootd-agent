/**
 * session 身份短缓存：省掉每个 API / session 探针的 User 查询。
 *
 * sessionVersion 单调递增，据此保证吊销语义：
 * - token 版本 == 缓存版本 → 命中
 * - token 版本 <  缓存版本 → 已吊销，直接拒绝（不查库）
 * - token 版本 >  缓存版本（改密后续签的新 token）或缓存过期 → 回源刷新
 * 因此旧设备在新 token 首次请求后立即失效，最迟不超过一个 TTL。
 */

export interface SessionIdentity {
  id: string;
  username: string;
  sessionVersion: number;
  clientProfileId: string;
  hasSecurityQuestions: boolean;
}

export type SessionIdentityResolveResult = {
  identity: SessionIdentity | null;
  /** true = 未打库（命中或凭缓存拒绝旧 token） */
  cacheHit: boolean;
};

interface CacheOptions {
  ttlMs: number;
  maxEntries: number;
  load: (userId: string) => Promise<SessionIdentity | null>;
  now?: () => number;
}

export interface SessionIdentityCache {
  resolve: (userId: string, sessionVersion: number) => Promise<SessionIdentityResolveResult>;
}

export function createSessionIdentityCache({
  ttlMs,
  maxEntries,
  load,
  now = Date.now,
}: CacheOptions): SessionIdentityCache {
  const entries = new Map<string, { identity: SessionIdentity; expiresAt: number }>();

  return {
    async resolve(userId, sessionVersion) {
      const cached = entries.get(userId);
      if (cached && cached.expiresAt > now()) {
        if (cached.identity.sessionVersion === sessionVersion) {
          return { identity: cached.identity, cacheHit: true };
        }
        if (cached.identity.sessionVersion > sessionVersion) {
          return { identity: null, cacheHit: true };
        }
      }

      const identity = await load(userId);
      entries.delete(userId);
      if (!identity) {
        return { identity: null, cacheHit: false };
      }

      entries.set(userId, { identity, expiresAt: now() + ttlMs });
      if (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      return {
        identity: identity.sessionVersion === sessionVersion ? identity : null,
        cacheHit: false,
      };
    },
  };
}
