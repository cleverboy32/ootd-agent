import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_COOKIE_NAME,
  getOwnerClientId,
  isPublicReadRequest,
  verifyAccessSessionToken,
} from '@/server/auth/access';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/server/auth/session';

/**
 * 双模式闸门：
 * - access（默认）：单用户访问码 + 固定 owner 身份（比赛演示/内测）
 * - user：登录体系，session → 查库校验 sessionVersion → 注入真实用户身份
 *
 * 注意：Proxy 在 Next 16 默认 Node.js 运行时，Prisma 可用。
 */

/** AUTH_MODE=user 启用登录体系；缺省/其他值均为 access */
export function getAuthMode(): 'user' | 'access' {
  return process.env.AUTH_MODE?.trim() === 'user' ? 'user' : 'access';
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: '请先登录', code: 'UNAUTHENTICATED' }, { status: 401 });
}

async function proxyUserMode(req: NextRequest): Promise<NextResponse> {
  const payload = await verifySessionToken(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!payload) return unauthorized();

  // sessionVersion 校验：改密/重置后旧票据即时失效。
  // db 模块加载即读 DATABASE_URL，惰性 import 保证 access 模式与单测环境不触库
  let user: { id: string; sessionVersion: number; clientProfileId: string } | null;
  try {
    const { default: prismadb } = await import('@/server/db');
    user = await prismadb.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, sessionVersion: true, clientProfileId: true },
    });
  } catch (error) {
    console.error('[PROXY] user lookup failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
  if (!user || user.sessionVersion !== payload.sessionVersion) return unauthorized();

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
