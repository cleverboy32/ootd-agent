import { NextRequest, NextResponse } from 'next/server';
import { resolvePageGate } from '@/lib/pageGate';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/server/auth/session';
import { sessionIdentityStore } from '@/server/auth/sessionIdentityStore';

/**
 * 登录闸门：API 查库校验 sessionVersion 并注入身份。
 * 页面只验 HMAC cookie，不查库。Proxy 在 Next 16 默认 Node.js 运行时，Prisma 可用。
 */

function unauthorized(): NextResponse {
  return NextResponse.json({ error: '请先登录', code: 'UNAUTHENTICATED' }, { status: 401 });
}

function redirectTo(req: NextRequest, location: string): NextResponse {
  const url = req.nextUrl.clone();
  const target = new URL(location, 'http://n');
  url.pathname = target.pathname;
  url.search = target.search;
  return NextResponse.redirect(url);
}

/** 页面分流：有效 cookie 进产品页，未登录产品页进官网。不查库。 */
async function gatePage(req: NextRequest): Promise<NextResponse> {
  const payload = await verifySessionToken(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  const decision = resolvePageGate({
    pathname: req.nextUrl.pathname,
    search: req.nextUrl.search,
    hasSession: Boolean(payload),
  });
  if (decision.type === 'next') return NextResponse.next();
  return redirectTo(req, decision.location);
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith('/api/')) {
    return gatePage(req);
  }
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
  matcher: [
    /*
     * 必须显式包含 `/`：仅 `/((?!...).*)` 时根路径不会进 proxy，
     * 已登录访问官网就无法重定向到 /home。
     */
    '/',
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
