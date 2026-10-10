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
  const body = (await req.json().catch(() => null)) as LoginBody | null;
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
    if (!user) {
      await logAuthEvent({ action: 'login', outcome: 'failure', username, reason: 'credentials_invalid' });
      return NextResponse.json(
        { error: '用户名或密码不正确', code: 'CREDENTIALS_INVALID' },
        { status: 401 }
      );
    }

    const lock = getLockStatus(user);
    if (lock.locked) return lockedResponse(lock.retryAfterSec);

    const ok = await verifySecret(password, user.passwordHash);
    if (!ok) {
      const next = registerFailure(user);
      await prismadb.user.update({ where: { id: user.id }, data: next });
      await logAuthEvent({ action: 'login', outcome: 'failure', username, reason: 'credentials_invalid' });
      const nowLocked = getLockStatus(next);
      if (nowLocked.locked) return lockedResponse(nowLocked.retryAfterSec);
      return NextResponse.json(
        { error: '用户名或密码不正确', code: 'CREDENTIALS_INVALID' },
        { status: 401 }
      );
    }

    await prismadb.user.update({ where: { id: user.id }, data: resetFailures() });
    const token = await createSessionToken(user.id, user.sessionVersion);
    const response = NextResponse.json({ user: { id: user.id, username: user.username } });
    setSessionCookie(response, token);
    await logAuthEvent({ action: 'login', outcome: 'success', username, userId: user.id });
    return response;
  } catch (error) {
    console.error('[AUTH_LOGIN]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
