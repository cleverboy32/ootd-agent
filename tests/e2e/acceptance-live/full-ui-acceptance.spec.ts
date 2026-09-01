import { expect, test } from '@playwright/test';
import {
  ensureVerifiedAccess,
  logoutIfVerified,
  requireLiveEnv,
  verifyAccessViaUi,
} from '../helpers/live-env';

/**
 * 真实 UI 走查：无 API mock，串行执行。
 * 标签 @live
 */
test.describe.configure({ mode: 'serial' });

test.describe('live UI acceptance @live', () => {
  test('[LIVE-U1] home page renders greeting', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('你好，我是你的专属时尚搭配助手')).toBeVisible();
  });

  test('[LIVE-U2] wardrobe page loads real wardrobe from API', async ({ page }) => {
    await page.goto('/wardrobe');
    await expect(page.getByText(/共 \d+ 件衣物/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('tab', { name: '全部' })).toBeVisible();
  });

  test('[LIVE-U3] profile page loads real client profile', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.getByText('档案概览')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('昵称')).toBeVisible();
  });

  test('[LIVE-U4] AppSidebar navigation between wardrobe and profile', async ({ page }) => {
    await page.goto('/wardrobe');
    await expect(page.getByText(/共 \d+ 件衣物/)).toBeVisible({ timeout: 20_000 });

    await page.getByRole('link', { name: '我的档案' }).click();
    await expect(page).toHaveURL('/profile');
    await expect(page.getByText('档案概览')).toBeVisible();

    await page.getByRole('link', { name: '衣橱总览' }).click();
    await expect(page).toHaveURL('/wardrobe');
    await expect(page.getByRole('tab', { name: '上装' })).toBeVisible();
  });

  test('[LIVE-A1] real ACCESS_CODE verify unlocks chat input', async ({ page }) => {
    requireLiveEnv();
    await page.goto('/');
    await logoutIfVerified(page);

    await expect(page.getByText('浏览模式')).toBeVisible();
    await expect(page.getByPlaceholder('浏览模式下不可发送消息')).toBeDisabled();

    await verifyAccessViaUi(page);
    await expect(page.getByPlaceholder('上传衣服照片，获取搭配建议...')).toBeEnabled();
    await expect(page.getByText('商务搭配')).toBeVisible();
  });

  test('[LIVE-A2] real logout returns to browse mode', async ({ page }) => {
    requireLiveEnv();
    await page.goto('/');
    await ensureVerifiedAccess(page);
    await logoutIfVerified(page);

    await expect(page.getByText('浏览模式')).toBeVisible();
    await expect(page.getByPlaceholder('浏览模式下不可发送消息')).toBeDisabled();
  });

  test('[LIVE-C1] real LLM chat returns assistant text in UI', async ({ page }) => {
    test.setTimeout(180_000);
    requireLiveEnv();
    await page.goto('/');
    await ensureVerifiedAccess(page);

    const userMessage = '我衣橱里有没有白裙子';
    const input = page.getByPlaceholder('上传衣服照片，获取搭配建议...');
    await input.fill(userMessage);
    await page.getByRole('button', { name: '发送消息' }).click();

    await expect(page.getByRole('main').getByText(userMessage)).toBeVisible({
      timeout: 15_000,
    });

    const assistantText = page.locator('.prose').filter({ hasText: /.{8,}/ });
    await expect(assistantText.first()).toBeVisible({ timeout: 150_000 });
    await expect(page.getByText('消息生成失败')).toBeHidden();
  });
});
