import { expect, test, type Page, type Route } from '@playwright/test';
import { mockVerifiedAccess } from './helpers/mock-access';
import { mockSuccessfulChatStream } from './helpers/mock-apis';

type CreateHandler = (route: Route) => Promise<void>;

async function mockConversationsWith(page: Page, onCreate: CreateHandler): Promise<void> {
  await page.route('**/api/conversations**', async (route) => {
    const req = route.request();
    const pathname = new URL(req.url()).pathname.replace(/^\/ootd(?=\/)/, '');
    if (req.method() === 'GET' && pathname === '/api/conversations') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    if (req.method() === 'POST' && pathname === '/api/conversations') {
      await onCreate(route);
      return;
    }
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
  });
}

function fulfillCreated(route: Route): Promise<void> {
  return route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({ id: 'e2e-conv-1', title: '测试', messages: [] }),
  });
}

async function sendFirstMessage(page: Page, text: string): Promise<void> {
  await page.goto('/');
  const input = page.getByPlaceholder('上传衣服照片，获取搭配建议...');
  await input.click();
  await input.pressSequentially(text);
  const sendButton = page.getByRole('button', { name: '发送消息' });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();
}

test.describe('new conversation optimistic send', () => {
  test('[ACC-C4] shows the first message before the conversation is persisted', async ({ page }) => {
    await mockVerifiedAccess(page);
    await mockSuccessfulChatStream(page, '白裙子搭配建议');

    let releaseCreate: () => void = () => {};
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    let createBody: unknown;
    await mockConversationsWith(page, async (route) => {
      createBody = route.request().postDataJSON();
      await createGate;
      await fulfillCreated(route);
    });
    const messagePosts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/conversations\/[^/]+\/messages$/.test(new URL(request.url()).pathname)) {
        messagePosts.push(request.url());
      }
    });

    await sendFirstMessage(page, '有没有白裙子');

    // 会话创建仍被挂起时，用户消息已在对话区
    await expect(page.getByRole('main').getByText('有没有白裙子')).toBeVisible({ timeout: 2_000 });

    releaseCreate();
    await expect(page.getByText('白裙子搭配建议')).toBeVisible();

    // 首条消息随建会话一次落库，不再单独 POST messages
    expect(createBody).toMatchObject({
      firstMessage: { role: 'user', content: [{ type: 'text', content: '有没有白裙子' }] },
    });
    expect(messagePosts).toHaveLength(0);
  });

  test('[ACC-C5] failed conversation creation keeps the message and retries', async ({ page }) => {
    await mockVerifiedAccess(page);
    await mockSuccessfulChatStream(page, '重试后创建成功');

    let createCalls = 0;
    await mockConversationsWith(page, async (route) => {
      createCalls += 1;
      if (createCalls === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal Server Error' }),
        });
        return;
      }
      await fulfillCreated(route);
    });

    await sendFirstMessage(page, '帮我搭一套通勤');

    await expect(page.getByRole('main').getByText('帮我搭一套通勤')).toBeVisible();
    const failureRow = page.getByText('发送失败，请检查网络');
    await expect(failureRow).toBeVisible();

    await page.getByRole('button', { name: '重试' }).click();

    await expect(failureRow).toBeHidden();
    await expect(page.getByText('重试后创建成功')).toBeVisible();
    expect(createCalls).toBe(2);
  });
});
