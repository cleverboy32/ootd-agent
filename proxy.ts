import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/server/auth/session';
import { createSessionIdentityCache } from '@/server/auth/sessionIdentityCache';

/**
 * 登录闸门：session → 查库校验 sessionVersion → 注入真实用户身份。
 * Proxy 在 Next 16 默认 Node.js 运行时，Prisma 可用。
 */

function unauthorized(): NextResponse {
  return NextResponse.json({ error: '请先登录', code: 'UNAUTHENTICATED' }, { status: 401 });
}

// 每请求查 User 实测 +200ms~1.2s（neon HTTP）；30s TTL 内命中缓存，吊销语义见 sessionIdentityCache
const sessionIdentityCache = createSessionIdentityCache({
  ttlMs: 30_000,
  maxEntries: 1000,
  load: async (userId) => {
    const { default: prismadb } = await import('@/server/db');
    return prismadb.user.findUnique({
      where: { id: userId },
      select: { id: true, sessionVersion: true, clientProfileId: true },
    });
  },
});

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // auth 路由只认 cookie/session，不读 x-client-id
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  const payload = await verifySessionToken(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!payload) return unauthorized();

  let user: { id: string; sessionVersion: number; clientProfileId: string } | null;
  try {
    user = await sessionIdentityCache.resolve(payload.userId, payload.sessionVersion);
  } catch (error) {
    console.error('[PROXY] user lookup failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
  if (!user) return unauthorized();

  // 覆写客户端自报 header，身份只能来自 session
  const headers = new Headers(req.headers);
  headers.set('x-client-id', user.clientProfileId);
  headers.set('x-user-id', user.id);
  headers.set('x-access-mode', 'user');
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: '/api/:path*',
};
