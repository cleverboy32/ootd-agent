import { NextRequest, NextResponse } from 'next/server';
import { normalizeUsername } from '@/server/auth/credentials';
import { getLockStatus, registerFailure, resetFailures } from '@/server/auth/lockout';
import { verifySecret } from '@/server/auth/password';
import { createSessionToken } from '@/server/auth/session';
import { setSessionCookie } from '@/server/auth/sessionCookie';
import prismadb from '@/server/db';
import { logAuthEvent } from '@/server/logging/authAudit';

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

function lockedResponse(retryAfterSec: number) {
  return NextResponse.json(
    {
      error: `失败次数过多，账号已锁定，请 ${Math.ceil(retryAfterSec / 60)} 分钟后再试`,
      code: 'ACCOUNT_LOCKED',
      retryAfterSec,
    },
    { status: 423 }
  );
}

export async function POST(req: NextRequest) {
  const t0 = performance.now();
  const mark = (label: string, since: number) => {
    const now = performance.now();
    console.log(`[AUTH_LOGIN_TIMING] ${label}=${Math.round(now - since)}ms`);
    return now;
  };

  let t = t0;
  const body = (await req.json().catch(() => null)) as LoginBody | null;
  t = mark('parse_body', t);
  const username = normalizeUsername(typeof body?.username === 'string' ? body.username : '');
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!username || !password) {
    return NextResponse.json(
      { error: '请输入用户名和密码', code: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  }

  try {
    const user = await prismadb.user.findUnique({ where: { username } });
    t = mark('db_find_user', t);
    if (!user) {
      await logAuthEvent({ action: 'login', outcome: 'failure', username, reason: 'credentials_invalid' });
      mark('audit_failure', t);
      mark('total', t0);
      return NextResponse.json(
        { error: '用户名或密码不正确', code: 'CREDENTIALS_INVALID' },
        { status: 401 }
      );
    }

    const lock = getLockStatus(user);
    if (lock.locked) {
      await logAuthEvent({ action: 'login', outcome: 'failure', username, reason: 'account_locked' });
      mark('audit_locked', t);
      mark('total', t0);
      return lockedResponse(lock.retryAfterSec);
    }

    const ok = await verifySecret(password, user.passwordHash);
    t = mark('scrypt_verify', t);
    if (!ok) {
      const next = registerFailure(user);
      await prismadb.user.update({ where: { id: user.id }, data: next });
      t = mark('db_register_failure', t);
      await logAuthEvent({ action: 'login', outcome: 'failure', username, reason: 'credentials_invalid' });
      mark('audit_failure', t);
      mark('total', t0);
      const nowLocked = getLockStatus(next);
      if (nowLocked.locked) return lockedResponse(nowLocked.retryAfterSec);
      return NextResponse.json(
        { error: '用户名或密码不正确', code: 'CREDENTIALS_INVALID' },
        { status: 401 }
      );
    }

    await prismadb.user.update({ where: { id: user.id }, data: resetFailures() });
    t = mark('db_reset_failures', t);
    const token = await createSessionToken(user.id, user.sessionVersion);
    t = mark('create_session_token', t);
    const response = NextResponse.json({ user: { id: user.id, username: user.username } });
    setSessionCookie(response, token);
    await logAuthEvent({ action: 'login', outcome: 'success', username, userId: user.id });
    mark('audit_success', t);
    mark('total', t0);
    return response;
  } catch (error) {
    console.error('[AUTH_LOGIN]', error);
    mark('total_error', t0);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
