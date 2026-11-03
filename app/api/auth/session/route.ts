import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/server/auth/session';
import { sessionIdentityStore } from '@/server/auth/sessionIdentityStore';

/** 登录态探针：永不 401，前端据此决定是否跳登录页 */
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
    console.error('[AUTH_SESSION] identity lookup failed:', error);
    console.log(
      '[AUTH_SESSION_TIMING]',
      JSON.stringify({
        authenticated: false,
        reason: 'lookup_error',
        verifyMs,
        lookupMs: Date.now() - lookupStart,
        cacheHit,
        totalMs: Date.now() - totalStart,
      })
    );
    return NextResponse.json({ authenticated: false });
  }
}
