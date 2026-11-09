import { expect, test } from '@playwright/test';

/**
 * 登录体系 UI 级 e2e：未登录产品页回官网 → 弹窗登录 → 进产品首页。
 */

const PASSWORD = 'abc12345';

test('unauthenticated visit redirects to landing then login reaches home', async ({ page }) => {
  const username = `ui${Math.random().toString(36).slice(2, 8)}`;
  const register = await page.request.post('/api/auth/register', {
    data: { username, password: PASSWORD },
  });
  expect(register.status()).toBe(200);
  await page.request.post('/api/auth/logout');

  await page.goto('/ootd');
  await expect(page).toHaveURL(/\/ootd\/?$/);
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();

  await page.goto('/ootd/home');
  await expect(page).toHaveURL(/\/ootd\/?$/);
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: '登录', exact: true }).first().click();
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(PASSWORD);
  await page.locator('#login-password').press('Enter');

  await expect(page).toHaveURL(/\/ootd\/home\/?$/);

  // 登录态即完整能力：不出现访问码浏览模式，聊天可输入
  await expect(page.getByPlaceholder('上传衣服照片，获取搭配建议...')).toBeEnabled();
  await expect(page.getByText('浏览模式')).toHaveCount(0);

  await page.goto('/ootd/profile');
  await expect(page.getByText(username, { exact: true })).toBeVisible();

  await page.goto('/ootd/');
  await page.getByRole('button', { name: '我的' }).hover();
  await expect(page.getByRole('link', { name: '安全中心' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '退出登录' })).toBeVisible();
});
