import { NextResponse } from 'next/server';
import { ACCESS_COOKIE_NAME } from '@/server/auth/access';

export async function POST() {
  const response = NextResponse.json({ mode: 'browse' });
  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}
