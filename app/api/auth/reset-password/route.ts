import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeRecoveryCode,
  normalizeSecurityAnswer,
  normalizeUsername,
} from '@/server/auth/credentials';
import { getLockStatus, registerFailure, resetFailures } from '@/server/auth/lockout';
import { hashSecret, validatePasswordStrength, verifySecret } from '@/server/auth/password';
import { createSessionToken } from '@/server/auth/session';
import { setSessionCookie } from '@/server/auth/sessionCookie';
import prismadb from '@/server/db';
import { logAuthEvent } from '@/server/logging/authAudit';

interface ResetPasswordBody {
  username?: unknown;
  method?: unknown;
  answers?: unknown;
  recoveryCode?: unknown;
  newPassword?: unknown;
}

interface StoredSecurityQuestion {
  question: string;
  answerHash: string;
}

function parseStoredQuestions(raw: unknown): StoredSecurityQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is StoredSecurityQuestion =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as StoredSecurityQuestion).question === 'string' &&
      typeof (item as StoredSecurityQuestion).answerHash === 'string'
  );
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
  const body = (await req.json().catch(() => null)) as ResetPasswordBody | null;
  const username = normalizeUsername(typeof body?.username === 'string' ? body.username : '');
  const method = body?.method === 'recovery' ? 'recovery' : body?.method === 'questions' ? 'questions' : null;
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';

  if (!username || !method) {
    return NextResponse.json({ error: '请求参数不完整', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) {
    return NextResponse.json({ error: strengthError, code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  try {
    const user = await prismadb.user.findUnique({ where: { username } });
    if (!user) {
      return NextResponse.json(
        { error: '重置失败，请检查输入', code: 'RESET_FAILED' },
        { status: 403 }
      );
    }

    const lock = getLockStatus(user);
    if (lock.locked) return lockedResponse(lock.retryAfterSec);

    let remainingRecoveryHashes: string[] | null = null;

    if (method === 'questions') {
      const stored = parseStoredQuestions(user.securityQuestions);
      if (stored.length === 0) {
        return NextResponse.json(
          { error: '该账号未设置密保问题，请使用恢复码或联系管理员', code: 'RESET_UNAVAILABLE' },
          { status: 403 }
        );
      }
      const answers = Array.isArray(body?.answers) ? body.answers : [];
      if (answers.length !== stored.length) {
        return NextResponse.json(
          { error: '请回答全部密保问题', code: 'VALIDATION_ERROR' },
          { status: 400 }
        );
      }
      let allMatch = true;
      for (let i = 0; i < stored.length; i += 1) {
        const answer = typeof answers[i] === 'string' ? answers[i] : '';
        const ok = await verifySecret(normalizeSecurityAnswer(answer), stored[i].answerHash);
        if (!ok) allMatch = false;
      }
      if (!allMatch) {
        const next = registerFailure(user);
        await prismadb.user.update({ where: { id: user.id }, data: next });
        await logAuthEvent({ action: 'reset_password', outcome: 'failure', username, reason: 'answers_mismatch' });
        const nowLocked = getLockStatus(next);
        if (nowLocked.locked) return lockedResponse(nowLocked.retryAfterSec);
        return NextResponse.json(
          { error: '密保答案不正确', code: 'ANSWERS_MISMATCH' },
          { status: 403 }
        );
      }
    } else {
      // recovery：任一未使用恢复码匹配即通过，命中后消费该码
      const code = normalizeRecoveryCode(
        typeof body?.recoveryCode === 'string' ? body.recoveryCode : ''
      );
      if (!code) {
        return NextResponse.json({ error: '请输入恢复码', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      let matchedIndex = -1;
      for (let i = 0; i < user.recoveryCodeHashes.length; i += 1) {
        if (await verifySecret(code, user.recoveryCodeHashes[i])) {
          matchedIndex = i;
          break;
        }
      }
      if (matchedIndex < 0) {
        const next = registerFailure(user);
        await prismadb.user.update({ where: { id: user.id }, data: next });
        await logAuthEvent({ action: 'reset_password', outcome: 'failure', username, reason: 'recovery_invalid' });
        const nowLocked = getLockStatus(next);
        if (nowLocked.locked) return lockedResponse(nowLocked.retryAfterSec);
        return NextResponse.json(
          { error: '恢复码不正确或已被使用', code: 'RECOVERY_INVALID' },
          { status: 403 }
        );
      }
      remainingRecoveryHashes = user.recoveryCodeHashes.filter((_, i) => i !== matchedIndex);
    }

    // 重置成功：新密码 + sessionVersion+1（旧 session 全失效）+ 清锁定，当前会话自动登录
    const nextVersion = user.sessionVersion + 1;
    await prismadb.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashSecret(newPassword),
        sessionVersion: nextVersion,
        ...resetFailures(),
        ...(remainingRecoveryHashes ? { recoveryCodeHashes: remainingRecoveryHashes } : {}),
      },
    });

    const token = await createSessionToken(user.id, nextVersion);
    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, token);
    await logAuthEvent({
      action: 'reset_password',
      outcome: 'success',
      username,
      userId: user.id,
    });
    return response;
  } catch (error) {
    console.error('[AUTH_RESET_PASSWORD]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
