import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/server/auth/currentUser';
import { hashSecret, validatePasswordStrength, verifySecret } from '@/server/auth/password';
import { createSessionToken } from '@/server/auth/session';
import { setSessionCookie } from '@/server/auth/sessionCookie';
import prismadb from '@/server/db';
import { logAuthEvent } from '@/server/logging/authAudit';

interface ChangePasswordBody {
  oldPassword?: unknown;
  newPassword?: unknown;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: '请先登录', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as ChangePasswordBody | null;
  const oldPassword = typeof body?.oldPassword === 'string' ? body.oldPassword : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';

  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) {
    return NextResponse.json({ error: strengthError, code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  try {
    const oldOk = await verifySecret(oldPassword, user.passwordHash);
    if (!oldOk) {
      await logAuthEvent({
        action: 'change_password',
        outcome: 'failure',
        username: user.username,
        userId: user.id,
        reason: 'old_password_wrong',
      });
      return NextResponse.json(
        { error: '原密码不正确', code: 'OLD_PASSWORD_WRONG' },
        { status: 403 }
      );
    }

    // bump sessionVersion：其他设备的 session 全部失效，当前会话续签
    const nextVersion = user.sessionVersion + 1;
    await prismadb.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashSecret(newPassword), sessionVersion: nextVersion },
    });

    const token = await createSessionToken(user.id, nextVersion);
    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, token);
    await logAuthEvent({
      action: 'change_password',
      outcome: 'success',
      username: user.username,
      userId: user.id,
    });
    return response;
  } catch (error) {
    console.error('[AUTH_CHANGE_PASSWORD]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
