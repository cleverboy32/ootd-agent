import { expect, test } from '@playwright/test';
import { mockVerifiedAccess } from './helpers/mock-access';
import { mockConversationApis } from './helpers/mock-apis';

test.describe('chat network error handling', () => {
  test('[ACC-C2] shows send failure below the user message and allows retry', async ({ page }) => {
    await mockVerifiedAccess(page);
    let shouldFail = true;

    await page.route('**/api/generate-with-image', async (route) => {
      if (shouldFail) {
        shouldFail = false;
        await route.abort('failed');
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          `event: metadata\ndata: ${JSON.stringify({ messageId: 'e2e-ai-message-1' })}\n\n` +
          `event: text_chunk\ndata: ${JSON.stringify({ text: '重试成功' })}\n\n` +
          `event: stream_end\ndata: ${JSON.stringify({ message: 'done' })}\n\n`,
      });
    });

    await mockConversationApis(page);

    await page.goto('/');

    const input = page.getByPlaceholder('上传衣服照片，获取搭配建议...');
    await input.click();
    await input.pressSequentially('测试网络失败');
    const sendButton = page.getByRole('button', { name: '发送消息' });
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    const main = page.getByRole('main');
    await expect(main.getByText('测试网络失败')).toBeVisible();
    const failureRow = page.getByText('发送失败，请检查网络');
    await expect(failureRow).toBeVisible();

    await page.getByRole('button', { name: '重试' }).click();

    await expect(failureRow).toBeHidden();
    await expect(page.getByText('重试成功')).toBeVisible();
  });

  test('[ACC-C3] shows retry on AI message when stream errors mid-response', async ({ page }) => {
    await mockVerifiedAccess(page);
    let callCount = 0;

    await page.route('**/api/generate-with-image', async (route) => {
      callCount += 1;

      if (callCount === 1) {
        // 第一次：发出部分内容后注入 error 事件
        // 注意：每个事件块末尾需双换行 \n\n，确保 SSE 解析器不把最后一个事件当残留缓冲丢掉
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body:
            `event: metadata\ndata: ${JSON.stringify({ messageId: 'e2e-ai-mid-error' })}\n\n` +
            `event: text_chunk\ndata: ${JSON.stringify({ text: '正在为你搭配...' })}\n\n` +
            `event: error\ndata: ${JSON.stringify({ message: '服务暂时不可用，请稍后重试' })}\n\n`,
        });
      }

      // 第二次（重试）：正常完成
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          `event: metadata\ndata: ${JSON.stringify({ messageId: 'e2e-ai-mid-error' })}\n\n` +
          `event: text_chunk\ndata: ${JSON.stringify({ text: '重试后正常返回' })}\n\n` +
          `event: stream_end\ndata: ${JSON.stringify({ message: 'done' })}\n\n`,
      });
    });

    await mockConversationApis(page);
    await page.goto('/');

    const input = page.getByPlaceholder('上传衣服照片，获取搭配建议...');
    await input.click();
    await input.pressSequentially('帮我搭配一套');
    const sendButton = page.getByRole('button', { name: '发送消息' });
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    // AI 消息应显示部分内容 + failed 状态 + 重试按钮
    await expect(page.getByText('正在为你搭配...')).toBeVisible();
    await expect(page.getByText('消息生成失败')).toBeVisible();

    // 点击重试
    await page.getByRole('button', { name: '重试' }).click();

    // 重试后错误提示消失，新内容出现
    await expect(page.getByText('消息生成失败')).toBeHidden();
    await expect(page.getByText('重试后正常返回')).toBeVisible();
  });
});
