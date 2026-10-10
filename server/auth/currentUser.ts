import type { User } from '@prisma/client';
import type { NextRequest } from 'next/server';
import prismadb from '@/server/db';
import { SESSION_COOKIE_NAME, verifySessionToken } from './session';

/**
 * 从请求 cookie 解析当前登录用户（route handler 用，Node runtime）。
 * 校验链：签名+有效期 → 用户存在 → sessionVersion 一致（改密/重置后旧票据失效）。
 */
export async function getSessionUser(req: NextRequest): Promise<User | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const payload = await verifySessionToken(token);
  if (!payload) return null;

  try {
    const user = await prismadb.user.findUnique({ where: { id: payload.userId } });
    if (!user || user.sessionVersion !== payload.sessionVersion) return null;
    return user;
  } catch (error) {
    console.error('[AUTH] session user lookup failed:', error);
    return null;
  }
}
