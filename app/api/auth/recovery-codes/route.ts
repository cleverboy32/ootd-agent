import { NextRequest, NextResponse } from 'next/server';
import { generateRecoveryCodes, normalizeRecoveryCode } from '@/server/auth/credentials';
import { getSessionUser } from '@/server/auth/currentUser';
import { hashSecret } from '@/server/auth/password';
import prismadb from '@/server/db';
import { logAuthEvent } from '@/server/logging/authAudit';

/** POST：登录态重新生成 8 个恢复码（旧码全部作废；明文仅本次返回） */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: '请先登录', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  try {
    const codes = generateRecoveryCodes(8);
    const hashes: string[] = [];
    for (const code of codes) {
      hashes.push(await hashSecret(normalizeRecoveryCode(code)));
    }

    await prismadb.user.update({
      where: { id: user.id },
      data: { recoveryCodeHashes: hashes },
    });
    await logAuthEvent({
      action: 'generate_recovery_codes',
      outcome: 'success',
      username: user.username,
      userId: user.id,
    });
    return NextResponse.json({ codes });
  } catch (error) {
    console.error('[AUTH_RECOVERY_CODES]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
