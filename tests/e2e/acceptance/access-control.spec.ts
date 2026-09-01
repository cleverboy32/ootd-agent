import { expect, test } from '@playwright/test';
import { mockBrowseAccess, mockAccessVerify, mockAccessLogout } from '../helpers/mock-access';

test.describe('access control', () => {
  test('[ACC-A1] browse mode shows banner and disables chat input', async ({ page }) => {
    await mockBrowseAccess(page);
    await page.goto('/');

    await expect(page.getByText('浏览模式')).toBeVisible();
    await expect(page.getByText('仅可查看数据')).toBeVisible();

    const input = page.getByPlaceholder('浏览模式下不可发送消息');
    await expect(input).toBeVisible();
    await expect(input).toBeDisabled();
    await expect(page.getByRole('button', { name: '发送消息' })).toBeDisabled();
  });

  test('[ACC-A2] browse mode hides feature cards and shows browse hint', async ({ page }) => {
    await mockBrowseAccess(page);
    await page.goto('/');

    await expect(page.getByText('商务搭配')).toBeHidden();
    await expect(page.getByText('当前可浏览历史对话。输入访问码后即可开始新的搭配咨询。')).toBeVisible();
  });

  test('[ACC-A3] correct access code unlocks full mode', async ({ page }) => {
    await mockBrowseAccess(page);
    await page.goto('/');

    await page.getByRole('button', { name: '输入访问码' }).click();
    await page.getByPlaceholder('访问码').fill('correct-code');
    await page.getByRole('button', { name: '解锁完整功能' }).click();

    await expect(page.getByRole('button', { name: '退出完整模式' })).toBeVisible();
    await expect(page.getByPlaceholder('上传衣服照片，获取搭配建议...')).toBeEnabled();
  });

  test('[ACC-A4] wrong access code shows error', async ({ page }) => {
    await mockBrowseAccess(page);
    await mockAccessVerify(page, { success: false, error: '访问码错误' });
    await page.goto('/');

    await page.getByRole('button', { name: '输入访问码' }).click();
    await page.getByPlaceholder('访问码').fill('wrong');
    await page.getByRole('button', { name: '解锁完整功能' }).click();

    await expect(page.getByText('访问码错误')).toBeVisible();
    await expect(page.getByText('浏览模式')).toBeVisible();
  });

  test('[ACC-A5] logout returns to browse mode', async ({ page }) => {
    await mockBrowseAccess(page);
    await page.goto('/');

    await page.getByRole('button', { name: '输入访问码' }).click();
    await page.getByPlaceholder('访问码').fill('correct-code');
    await page.getByRole('button', { name: '解锁完整功能' }).click();
    await expect(page.getByRole('button', { name: '退出完整模式' })).toBeVisible();

    await mockAccessLogout(page);
    await mockBrowseAccess(page);
    await page.getByRole('button', { name: '退出完整模式' }).click();

    await expect(page.getByText('浏览模式')).toBeVisible();
    await expect(page.getByPlaceholder('浏览模式下不可发送消息')).toBeVisible();
  });
});
