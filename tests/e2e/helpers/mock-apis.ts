import type { Page, Route } from '@playwright/test';
import { MOCK_PROFILE, MOCK_WARDROBE_ITEMS } from './mock-data';

export async function mockConversationApis(page: Page): Promise<void> {
  await page.route('**/api/conversations**', async (route: Route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());

    if (req.method() === 'GET' && pathname === '/api/conversations') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    if (req.method() === 'POST' && pathname === '/api/conversations') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'e2e-conv-1', title: '测试', messages: [] }),
      });
      return;
    }
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
  });
}

export async function mockWardrobeApi(page: Page): Promise<void> {
  await page.route('**/api/wardrobe**', async (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_WARDROBE_ITEMS),
      });
      return;
    }
    await route.continue();
  });
}

export async function mockProfileApi(page: Page): Promise<void> {
  await page.route('**/api/clients/**', async (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PROFILE),
      });
      return;
    }
    await route.continue();
  });
}

export async function mockSuccessfulChatStream(page: Page, replyText = 'E2E mock 搭配建议'): Promise<void> {
  await page.route('**/api/generate-with-image', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body:
        `event: metadata\ndata: ${JSON.stringify({ messageId: 'e2e-ai-success' })}\n\n` +
        `event: text_chunk\ndata: ${JSON.stringify({ text: replyText })}\n\n` +
        `event: stream_end\ndata: ${JSON.stringify({ message: 'done' })}\n\n`,
    });
  });
}
