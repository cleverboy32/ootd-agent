import type { Page, Route } from '@playwright/test';
import { SESSION_COOKIE_NAME, createSessionToken } from '@/server/auth/session';

/**
 * 前端能力闸依赖 /api/auth/session。
 * 页面分流只验 HMAC cookie，这里签发一张测试票据，让 /home 等产品页能打开。
 */
export async function mockLoggedIn(page: Page): Promise<void> {
  await page.route('**/api/auth/session', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        user: { id: 'e2e-user', username: 'e2e', hasSecurityQuestions: false },
      }),
    });
  });

  const token = await createSessionToken('e2e-user', 0);
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
}
