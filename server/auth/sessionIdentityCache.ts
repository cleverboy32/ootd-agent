/**
 * proxy 用的 session 身份短缓存：省掉每个 API 请求的 User 查询。
 *
 * sessionVersion 单调递增，据此保证吊销语义：
 * - token 版本 == 缓存版本 → 命中
 * - token 版本 <  缓存版本 → 已吊销，直接拒绝（不查库）
 * - token 版本 >  缓存版本（改密后续签的新 token）或缓存过期 → 回源刷新
 * 因此旧设备在新 token 首次请求后立即失效，最迟不超过一个 TTL。
 */

export interface SessionIdentity {
  id: string;
  sessionVersion: number;
  clientProfileId: string;
}

interface CacheOptions {
  ttlMs: number;
  maxEntries: number;
  load: (userId: string) => Promise<SessionIdentity | null>;
  now?: () => number;
}

export interface SessionIdentityCache {
  resolve: (userId: string, sessionVersion: number) => Promise<SessionIdentity | null>;
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
        if (cached.identity.sessionVersion === sessionVersion) return cached.identity;
        if (cached.identity.sessionVersion > sessionVersion) return null;
      }

      const identity = await load(userId);
      entries.delete(userId);
      if (!identity) return null;

      entries.set(userId, { identity, expiresAt: now() + ttlMs });
      if (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      return identity.sessionVersion === sessionVersion ? identity : null;
    },
  };
}
