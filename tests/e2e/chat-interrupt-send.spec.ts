import { expect, test } from '@playwright/test';
import { mockLoggedIn } from './helpers/mock-session';
import { mockConversationApis } from './helpers/mock-apis';

/**
 * 连发打断：第一条 generate 故意挂起；发第二条后应出现第二条回复，且发起了第二次 generate。
 */
test('sending a second message aborts the first generate stream', async ({ page }) => {
  await mockLoggedIn(page);
  await mockConversationApis(page);

  let generateCount = 0;

  await page.route('**/api/generate-with-image', async (route) => {
    generateCount += 1;
    const n = generateCount;

    if (n === 1) {
      // 永不 fulfill；客户端 abort 后 Playwright 取消本 handler
      await new Promise(() => undefined);
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body:
        `event: metadata\ndata: ${JSON.stringify({ messageId: `e2e-ai-${n}` })}\n\n` +
        `event: text_chunk\ndata: ${JSON.stringify({ text: '第二条回复' })}\n\n` +
        `event: stream_end\ndata: ${JSON.stringify({ message: 'done' })}\n\n`,
    });
  });

  await page.goto('/');
  const input = page.getByPlaceholder('上传衣服照片，获取搭配建议...');
  await input.click();
  await input.pressSequentially('第一条');
  const sendButton = page.getByRole('button', { name: '发送消息' });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();
  await expect(page.getByRole('main').getByText('第一条')).toBeVisible();
  await expect.poll(() => generateCount).toBe(1);

  await input.pressSequentially('第二条');
  await expect(sendButton).toBeEnabled();
  await sendButton.click();
  await expect(page.getByRole('main').getByText('第二条')).toBeVisible();
  await expect(page.getByText('第二条回复')).toBeVisible({ timeout: 10000 });
  await expect.poll(() => generateCount).toBeGreaterThanOrEqual(2);
});
