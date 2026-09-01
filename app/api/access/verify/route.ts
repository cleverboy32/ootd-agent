import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_COOKIE_MAX_AGE_SECONDS,
  ACCESS_COOKIE_NAME,
  createAccessSessionToken,
  isAccessCodeValid,
  isAccessConfigured,
} from '@/server/auth/access';

export async function POST(req: NextRequest) {
  if (!isAccessConfigured()) {
    return NextResponse.json(
      { error: 'Access verification is not configured.' },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code : '';
  if (!isAccessCodeValid(code)) {
    return NextResponse.json({ error: '访问码不正确' }, { status: 401 });
  }

  const response = NextResponse.json({ mode: 'verified' });
  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: await createAccessSessionToken(),
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
