import type { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from './session';

/**
 * 用户 session cookie 设置（route handler 用）。
 * SameSite=Lax：微信/QQ 内点开链接的首次导航需携带 cookie（Strict 会误判未登录）。
 */
export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}
