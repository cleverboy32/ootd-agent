import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_COOKIE_NAME,
  isAccessConfigured,
  verifyAccessSessionToken,
} from '@/server/auth/access';
import { getSessionUser } from '@/server/auth/currentUser';
import { getAuthMode } from '@/server/auth/mode';

/** 前端能力探针：access 模式看访问码 cookie，user 模式看登录 session */
export async function GET(req: NextRequest) {
  if (getAuthMode() === 'user') {
    const user = await getSessionUser(req);
    return NextResponse.json({
      mode: user ? 'verified' : 'browse',
      configured: true,
      authMode: 'user',
    });
  }

  const verified = await verifyAccessSessionToken(
    req.cookies.get(ACCESS_COOKIE_NAME)?.value
  );

  return NextResponse.json({
    mode: verified ? 'verified' : 'browse',
    configured: isAccessConfigured(),
    authMode: 'access',
  });
}
