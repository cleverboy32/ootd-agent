import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_COOKIE_NAME,
  getOwnerClientId,
  isPublicReadRequest,
  verifyAccessSessionToken,
} from '@/server/auth/access';

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/api/access/')) {
    return NextResponse.next();
  }

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
