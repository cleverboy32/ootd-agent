import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_COOKIE_NAME,
  getOwnerClientId,
  isPublicReadRequest,
  verifyAccessSessionToken,
} from '@/server/auth/access';
import { getAuthMode } from '@/server/auth/mode';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/server/auth/session';
import { createSessionIdentityCache } from '@/server/auth/sessionIdentityCache';

/**
 * 双模式闸门：
 * - access（默认）：单用户访问码 + 固定 owner 身份（比赛演示/内测）
 * - user：登录体系，session → 查库校验 sessionVersion → 注入真实用户身份
 *
 * 注意：Proxy 在 Next 16 默认 Node.js 运行时，Prisma 可用。
 */

function unauthorized(): NextResponse {
  return NextResponse.json({ error: '请先登录', code: 'UNAUTHENTICATED' }, { status: 401 });
}

// 每请求查 User 实测 +200ms~1.2s（neon HTTP）；30s TTL 内命中缓存，吊销语义见 sessionIdentityCache
const sessionIdentityCache = createSessionIdentityCache({
  ttlMs: 30_000,
  maxEntries: 1000,
  // db 模块加载即读 DATABASE_URL，惰性 import 保证 access 模式与单测环境不触库
  load: async (userId) => {
    const { default: prismadb } = await import('@/server/db');
    return prismadb.user.findUnique({
      where: { id: userId },
      select: { id: true, sessionVersion: true, clientProfileId: true },
    });
  },
});

async function proxyUserMode(req: NextRequest): Promise<NextResponse> {
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

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // auth 路由只认 cookie/session，不读 x-client-id，两种模式下都直接放行
  if (pathname.startsWith('/api/access/') || pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  if (getAuthMode() === 'user') {
    return proxyUserMode(req);
  }

  // --- access 模式：单用户访问码（现状，勿改动行为） ---
  let ownerClientId: string;
  try {
    ownerClientId = getOwnerClientId();
  } catch {
    return NextResponse.json(
      { error: 'Single-user access is not configured.' },
      { status: 503 }
    );
  }

  const verified = await verifyAccessSessionToken(
    req.cookies.get(ACCESS_COOKIE_NAME)?.value
  );
  if (!verified && !isPublicReadRequest(pathname, req.method)) {
    return NextResponse.json(
      { error: '验证访问码后才能使用此功能', code: 'ACCESS_REQUIRED' },
      { status: 403 }
    );
  }

  const headers = new Headers(req.headers);
  headers.set('x-client-id', ownerClientId);
  headers.set('x-access-mode', verified ? 'verified' : 'browse');
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: '/api/:path*',
};
