import type { Page, Route } from '@playwright/test';

export type MockAccessMode = 'browse' | 'verified';

export async function mockAccessStatus(
  page: Page,
  mode: MockAccessMode,
  configured = true
): Promise<void> {
  await page.route('**/api/access/status', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mode, configured }),
    });
  });
}

export async function mockAccessVerify(
  page: Page,
  options: { success: boolean; error?: string } = { success: true }
): Promise<void> {
  await page.route('**/api/access/verify', async (route: Route) => {
    if (options.success) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: options.error ?? '访问码错误' }),
    });
  });
}

export async function mockAccessLogout(page: Page): Promise<void> {
  await page.route('**/api/access/logout', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
}

export async function mockBrowseAccess(page: Page): Promise<void> {
  await mockAccessStatus(page, 'browse');
  await mockAccessVerify(page, { success: true });
  await mockAccessLogout(page);
}

export async function mockVerifiedAccess(page: Page): Promise<void> {
  await mockAccessStatus(page, 'verified');
  await mockAccessVerify(page, { success: true });
  await mockAccessLogout(page);
}
