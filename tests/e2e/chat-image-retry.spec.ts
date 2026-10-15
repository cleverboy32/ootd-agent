import { expect, test } from '@playwright/test';
import { mockVerifiedAccess } from './helpers/mock-access';
import { mockConversationApis } from './helpers/mock-apis';

const sse = (events: Array<[string, unknown]>) =>
  events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');

test.describe('chat image retry', () => {
  test('[ACC-C4] 效果图失败后点「重新生成」，重试期间展示 loading', async ({ page }) => {
    await mockVerifiedAccess(page);
    await mockConversationApis(page);

    let releaseRetry!: () => void;
    const retryReleased = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });

    await page.route('**/api/generate-with-image', async (route) => {
      const body = route.request().postDataJSON() as { retryOutfitId?: string };

      if (!body.retryOutfitId) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: sse([
            ['metadata', { messageId: 'e2e-ai-image-retry' }],
            ['text_chunk', { text: '方案一：通勤简约风\n\n[IMAGE=outfit_1]\n\n' }],
            ['image_generation_failed', { id: 'outfit_1', message: 'mock fail', alt: '' }],
            ['stream_end', { message: 'done' }],
          ]),
        });
        return;
      }

      await retryReleased;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse([
          ['image_generation_failed', { id: 'outfit_1', message: 'mock fail again', alt: '' }],
          ['stream_end', { message: 'done' }],
        ]),
      });
    });

    await page.goto('/');

    const input = page.getByPlaceholder('上传衣服照片，获取搭配建议...');
    await input.click();
    await input.pressSequentially('帮我搭一套通勤');
    await page.getByRole('button', { name: '发送消息' }).click();

    await expect(page.getByText('图片生成失败')).toBeVisible();

    await page.getByRole('button', { name: '重新生成' }).click();

    await expect(page.getByText('正在生成穿搭效果图...')).toBeVisible();
    await expect(page.getByText('图片生成失败')).toBeHidden();

    releaseRetry();
    await expect(page.getByText('图片生成失败')).toBeVisible();
  });

  test('[ACC-C5] 历史消息中的失败效果图，重试期间展示 loading', async ({ page }) => {
    await mockVerifiedAccess(page);

    await page.route('**/api/conversations**', async (route) => {
      const pathname = new URL(route.request().url()).pathname.replace(/^\/ootd(?=\/)/, '');
      if (pathname === '/api/conversations') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: 'e2e-conv-history', title: '历史失败图', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          ]),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          nextCursor: null,
          messages: [
            { id: 'e2e-user-1', role: 'user', status: 'completed', createdAt: new Date().toISOString(), content: [{ type: 'text', content: '帮我搭一套' }] },
            {
              id: 'e2e-ai-1',
              role: 'ai',
              status: 'completed',
              createdAt: new Date().toISOString(),
              content: [
                { type: 'text', content: '方案一\n\n[IMAGE=outfit_1]\n\n' },
                { type: 'image_states', states: { outfit_1: 'failed' } },
              ],
            },
          ],
        }),
      });
    });

    let releaseRetry!: () => void;
    const retryReleased = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    await page.route('**/api/generate-with-image', async (route) => {
      await retryReleased;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse([
          ['image_generation_failed', { id: 'outfit_1', message: 'mock fail again', alt: '' }],
          ['stream_end', { message: 'done' }],
        ]),
      });
    });

    await page.goto('/');
    await page.getByText('历史失败图').click();
    await expect(page.getByText('图片生成失败')).toBeVisible();

    await page.getByRole('button', { name: '重新生成' }).click();

    await expect(page.getByText('正在生成穿搭效果图...')).toBeVisible();

    releaseRetry();
    await expect(page.getByText('图片生成失败')).toBeVisible();
  });
});
