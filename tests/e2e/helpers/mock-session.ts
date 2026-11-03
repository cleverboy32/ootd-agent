import type { Page, Route } from '@playwright/test';

/** 前端能力闸依赖 /api/auth/session；未登录会跳 /login */
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
}
