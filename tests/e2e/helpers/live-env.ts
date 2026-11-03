import { expect, type Page } from '@playwright/test';

const LIVE_PASSWORD = 'abc12345';

/** 注册并登录一个临时用户（cookie 写入 page context） */
export async function ensureLoggedIn(page: Page): Promise<{ username: string }> {
  const username = `live${Date.now().toString(36)}`;

  const register = await page.request.post('/api/auth/register', {
    data: { username, password: LIVE_PASSWORD },
  });
  if (!register.ok()) {
    const body = (await register.json().catch(() => null)) as { error?: string } | null;
    throw new Error(`register failed: ${register.status()} ${body?.error ?? ''}`.trim());
  }

  const login = await page.request.post('/api/auth/login', {
    data: { username, password: LIVE_PASSWORD },
  });
  if (!login.ok()) {
    const body = (await login.json().catch(() => null)) as { error?: string } | null;
    throw new Error(`login failed: ${login.status()} ${body?.error ?? ''}`.trim());
  }

  return { username };
}

export async function logoutViaApi(page: Page): Promise<void> {
  await page.request.post('/api/auth/logout');
}

export async function expectLoginPage(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('#login-username')).toBeVisible({ timeout: 15_000 });
}
