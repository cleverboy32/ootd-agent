import { NextRequest, NextResponse } from 'next/server';
import { isAccessCodeValid } from '@/server/auth/access';
import { normalizeUsername, validateUsername } from '@/server/auth/credentials';
import { hashSecret, validatePasswordStrength } from '@/server/auth/password';
import { createSessionToken } from '@/server/auth/session';
import { setSessionCookie } from '@/server/auth/sessionCookie';
import prismadb from '@/server/db';
import { logAuthEvent } from '@/server/logging/authAudit';

interface RegisterBody {
  username?: unknown;
  password?: unknown;
  inviteCode?: unknown;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as RegisterBody | null;
  const username = normalizeUsername(typeof body?.username === 'string' ? body.username : '');
  const password = typeof body?.password === 'string' ? body.password : '';

  const usernameError = validateUsername(username);
  if (usernameError) {
    return NextResponse.json({ error: usernameError, code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    return NextResponse.json({ error: passwordError, code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  // 邀请码：REGISTRATION_MODE=open 时跳过；默认 invite，复用 ACCESS_CODE
  const inviteRequired = (process.env.REGISTRATION_MODE?.trim() || 'invite') !== 'open';
  const inviteCode = typeof body?.inviteCode === 'string' ? body.inviteCode : '';
  if (inviteRequired && !isAccessCodeValid(inviteCode)) {
    await logAuthEvent({ action: 'register', outcome: 'failure', username, reason: 'invite_invalid' });
    return NextResponse.json({ error: '邀请码不正确', code: 'INVITE_INVALID' }, { status: 403 });
  }

  try {
    const existing = await prismadb.user.findUnique({ where: { username } });
    if (existing) {
      await logAuthEvent({ action: 'register', outcome: 'failure', username, reason: 'username_taken' });
      return NextResponse.json({ error: '用户名已被占用', code: 'USERNAME_TAKEN' }, { status: 409 });
    }

    const passwordHash = await hashSecret(password);
    const user = await prismadb.user.create({
      data: {
        username,
        passwordHash,
        clientProfile: { create: {} },
      },
    });

    const token = await createSessionToken(user.id, user.sessionVersion);
    const response = NextResponse.json({ user: { id: user.id, username: user.username } });
    setSessionCookie(response, token);
    await logAuthEvent({ action: 'register', outcome: 'success', username, userId: user.id });
    return response;
  } catch (error) {
    console.error('[AUTH_REGISTER]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
