import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/server/auth/session';
import { sessionIdentityStore } from '@/server/auth/sessionIdentityStore';

/**
 * 登录闸门：session → 查库校验 sessionVersion → 注入真实用户身份。
 * Proxy 在 Next 16 默认 Node.js 运行时，Prisma 可用。
 */

function unauthorized(): NextResponse {
  return NextResponse.json({ error: '请先登录', code: 'UNAUTHENTICATED' }, { status: 401 });
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // auth 路由只认 cookie/session，不读身份 header
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  const payload = await verifySessionToken(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!payload) return unauthorized();

  let userId: string | null;
  try {
    const { identity } = await sessionIdentityStore.resolve(
      payload.userId,
      payload.sessionVersion
    );
    userId = identity?.id ?? null;
  } catch (error) {
    console.error('[PROXY] user lookup failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
  if (!userId) return unauthorized();

  // 覆写客户端自报 header，身份只能来自 session
  const headers = new Headers(req.headers);
  headers.delete('x-client-id');
  headers.set('x-user-id', userId);
  headers.set('x-access-mode', 'user');
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: '/api/:path*',
};
