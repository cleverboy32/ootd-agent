import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/server/auth/session';
import { sessionIdentityStore } from '@/server/auth/sessionIdentityStore';

/** 登录态探针：token 无效才返回 authenticated:false；查库失败用 503，避免误判退出 */
export async function GET(req: NextRequest) {
  const totalStart = Date.now();

  const verifyStart = Date.now();
  const payload = await verifySessionToken(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  const verifyMs = Date.now() - verifyStart;

  if (!payload) {
    console.log(
      '[AUTH_SESSION_TIMING]',
      JSON.stringify({
        authenticated: false,
        reason: 'no_or_invalid_token',
        verifyMs,
        lookupMs: 0,
        cacheHit: false,
        totalMs: Date.now() - totalStart,
      })
    );
    return NextResponse.json({ authenticated: false });
  }

  const lookupStart = Date.now();
  let cacheHit = false;
  try {
    const resolved = await sessionIdentityStore.resolve(
      payload.userId,
      payload.sessionVersion
    );
    cacheHit = resolved.cacheHit;
    const lookupMs = Date.now() - lookupStart;
    const identity = resolved.identity;

    if (!identity) {
      console.log(
        '[AUTH_SESSION_TIMING]',
        JSON.stringify({
          authenticated: false,
          reason: 'identity_mismatch_or_missing',
          verifyMs,
          lookupMs,
          cacheHit,
          totalMs: Date.now() - totalStart,
        })
      );
      return NextResponse.json({ authenticated: false });
    }

    console.log(
      '[AUTH_SESSION_TIMING]',
      JSON.stringify({
        authenticated: true,
        verifyMs,
        lookupMs,
        cacheHit,
        totalMs: Date.now() - totalStart,
      })
    );

    return NextResponse.json({
      authenticated: true,
      user: {
        id: identity.id,
        username: identity.username,
        hasSecurityQuestions: identity.hasSecurityQuestions,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error && 'type' in error
          ? `ErrorEvent:${String((error as { type?: string }).type)}`
          : String(error);
    console.error('[AUTH_SESSION] identity lookup failed:', message, error);
    console.log(
      '[AUTH_SESSION_TIMING]',
      JSON.stringify({
        authenticated: null,
        reason: 'lookup_error',
        verifyMs,
        lookupMs: Date.now() - lookupStart,
        cacheHit,
        totalMs: Date.now() - totalStart,
      })
    );
    return NextResponse.json(
      { error: '登录态校验暂时失败', code: 'SESSION_LOOKUP_FAILED' },
      { status: 503 }
    );
  }
}
