import { expect, test } from '@playwright/test';
import { mockVerifiedAccess } from '../helpers/mock-access';
import { mockConversationApis, mockSuccessfulChatStream } from '../helpers/mock-apis';

test.describe('verified chat', () => {
  test('[ACC-C1] verified user can send message and receive mock SSE reply', async ({ page }) => {
    await mockVerifiedAccess(page);
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
