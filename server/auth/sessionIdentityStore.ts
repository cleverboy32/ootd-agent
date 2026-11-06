/**
 * proxy 与 /api/auth/session 共用的进程内身份缓存（单机 Map，30s TTL）。
 * 每请求查 User 实测 +200ms~1.2s（neon HTTP）；命中后 lookup 接近 0。
 */
import {
  createSessionIdentityCache,
  type SessionIdentity,
} from '@/server/auth/sessionIdentityCache';

export async function loadSessionIdentity(userId: string): Promise<SessionIdentity | null> {
  const { default: prismadb } = await import('@/server/db');
  const row = await prismadb.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      sessionVersion: true,
      securityQuestions: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    sessionVersion: row.sessionVersion,
    hasSecurityQuestions:
      Array.isArray(row.securityQuestions) && row.securityQuestions.length > 0,
  };
}

export const sessionIdentityStore = createSessionIdentityCache({
  ttlMs: 30_000,
  maxEntries: 1000,
  load: loadSessionIdentity,
});
