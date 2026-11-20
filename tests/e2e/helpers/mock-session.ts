import type { Page, Route } from '@playwright/test';
import { hashSecret } from '@/server/auth/password';
import { SESSION_COOKIE_NAME, createSessionToken } from '@/server/auth/session';
import prismadb from '@/server/db';

const FIXTURE_USERNAME = 'e2e';

type FixtureUser = {
  id: string;
  username: string;
  sessionVersion: number;
};

/** 确保库里有可验签的 fixture 用户；cookie 与真 session 都能对上。 */
async function ensureFixtureUser(): Promise<FixtureUser> {
  const existing = await prismadb.user.findUnique({
    where: { username: FIXTURE_USERNAME },
    select: { id: true, username: true, sessionVersion: true },
  });
  if (existing) return existing;

  return prismadb.user.create({
    data: {
      username: FIXTURE_USERNAME,
      // 仅占位；mock 测试不走密码登录
      passwordHash: await hashSecret('e2e-fixture-password-1'),
    },
    select: { id: true, username: true, sessionVersion: true },
  });
}

/**
 * 前端能力闸依赖 /api/auth/session。
 * 页面分流验 HMAC cookie；cookie 的 userId 必须在 DB 存在，
 * 否则真 session 回 authenticated:false，会和 proxy 形成 / ↔ /home 死循环。
 */
export async function mockLoggedIn(page: Page): Promise<FixtureUser> {
  const user = await ensureFixtureUser();

  await page.route('**/api/auth/session', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        user: {
          id: user.id,
          username: user.username,
          hasSecurityQuestions: false,
        },
      }),
    });
  });

  const token = await createSessionToken(user.id, user.sessionVersion);
  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  return user;
}
