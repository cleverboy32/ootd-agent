import { expect, test } from '@playwright/test';
import { mockLoggedIn } from '../helpers/mock-session';
import { mockConversationApis, mockSuccessfulChatStream } from '../helpers/mock-apis';

test.describe('logged-in chat', () => {
  test('[ACC-C1] logged-in user can send message and receive mock SSE reply', async ({ page }) => {
    await mockLoggedIn(page);
    await mockConversationApis(page);
    await mockSuccessfulChatStream(page, 'E2E mock 搭配建议');

    await page.goto('/');

    const input = page.getByPlaceholder('上传衣服照片，获取搭配建议...');
    await input.fill('帮我搭配一套日常通勤');
    await page.getByRole('button', { name: '发送消息' }).click();

    await expect(page.getByText('帮我搭配一套日常通勤')).toBeVisible();
    await expect(page.getByText('E2E mock 搭配建议')).toBeVisible();
  });
});
