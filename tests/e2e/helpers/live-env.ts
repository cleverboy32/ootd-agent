import { expect, type Page } from '@playwright/test';

export function requireLiveEnv(): { accessCode: string } {
  const accessCode = process.env.ACCESS_CODE?.trim();
  if (!accessCode) {
    throw new Error('ACCESS_CODE is required for live UI tests');
  }
  if (!process.env.NEXT_PUBLIC_OWNER_CLIENT_ID?.trim()) {
    throw new Error('NEXT_PUBLIC_OWNER_CLIENT_ID is required for live UI tests');
  }
  return { accessCode };
}

export async function isVerifiedMode(page: Page): Promise<boolean> {
  return page.getByRole('button', { name: '退出完整模式' }).isVisible().catch(() => false);
}

/** 在 browse 态下通过 UI 提交真实 ACCESS_CODE */
export async function verifyAccessViaUi(page: Page): Promise<void> {
  const { accessCode } = requireLiveEnv();

  await page.getByRole('button', { name: '输入访问码' }).click();
  const codeInput = page.getByPlaceholder('访问码');
  await expect(codeInput).toBeVisible();
  await codeInput.fill(accessCode);

  const verifyResponse = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/access/verify') && resp.request().method() === 'POST'
  );
  await page.getByRole('button', { name: '解锁完整功能' }).click();
  const response = await verifyResponse;

  if (!response.ok()) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(`verify API failed: ${response.status()} ${body?.error ?? ''}`.trim());
  }

  await expect(page.getByRole('button', { name: '退出完整模式' })).toBeVisible({
    timeout: 10_000,
  });
}

/** 若当前为 browse，用真实 ACCESS_CODE 解锁 */
export async function ensureVerifiedAccess(page: Page): Promise<void> {
  if (await isVerifiedMode(page)) return;

  await expect(page.getByText('浏览模式')).toBeVisible({ timeout: 15_000 });
  await verifyAccessViaUi(page);
}

export async function logoutIfVerified(page: Page): Promise<void> {
  if (!(await isVerifiedMode(page))) return;

  const logoutResponse = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/access/logout') && resp.request().method() === 'POST'
  );
  await page.getByRole('button', { name: '退出完整模式' }).click();
  await logoutResponse;
  await expect(page.getByText('浏览模式')).toBeVisible({ timeout: 10_000 });
}
