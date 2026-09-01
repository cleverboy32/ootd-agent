import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_COOKIE_NAME,
  isAccessConfigured,
  verifyAccessSessionToken,
} from '@/server/auth/access';

export async function GET(req: NextRequest) {
  const verified = await verifyAccessSessionToken(
    req.cookies.get(ACCESS_COOKIE_NAME)?.value
  );

  return NextResponse.json({
    mode: verified ? 'verified' : 'browse',
    configured: isAccessConfigured(),
  });
}
