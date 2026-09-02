import { expect, test } from '@playwright/test';
import { mockBrowseAccess, mockVerifiedAccess } from '../helpers/mock-access';
import { mockWardrobeApi, mockProfileApi } from '../helpers/mock-apis';

test.describe('navigation', () => {
  test('[ACC-N1] sidebar chat link loads home', async ({ page }) => {
    await mockBrowseAccess(page);
    await page.goto('/wardrobe');
    await mockWardrobeApi(page);

    await page.getByRole('link', { name: 'AI 搭配' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByText('你好，我是你的专属时尚搭配助手')).toBeVisible();
  });

  test('[ACC-N2] sidebar wardrobe link loads wardrobe page', async ({ page }) => {
    await mockBrowseAccess(page);
    await mockWardrobeApi(page);
    await mockProfileApi(page);
    // 聊天页用 SidebarLeft，无衣橱入口；从 profile 页的 AppSidebar 导航
    await page.goto('/profile');

    await page.getByRole('link', { name: '衣橱总览' }).click();
    await expect(page).toHaveURL('/wardrobe');
    await expect(page.getByText('共 2 件衣物')).toBeVisible();
  });

  test('[ACC-N3] sidebar profile link loads profile page', async ({ page }) => {
    await mockBrowseAccess(page);
    await mockProfileApi(page);
    await mockWardrobeApi(page);
    await page.goto('/wardrobe');

    await page.getByRole('link', { name: '我的档案' }).click();
    await expect(page).toHaveURL('/profile');
    await expect(page.getByText('E2E Tester')).toBeVisible();
  });

  test('[ACC-N4] browse mode hides add clothing on wardrobe overview', async ({ page }) => {
    await mockBrowseAccess(page);
    await mockWardrobeApi(page);
    await page.goto('/wardrobe');

    await expect(page.getByRole('link', { name: '添加衣物' })).toBeHidden();
    await expect(page.getByRole('button', { name: '添加衣物' })).toBeHidden();
  });

  test('[ACC-N5] verified mode shows add clothing next to batch manage, not in sidebar', async ({ page }) => {
    await mockVerifiedAccess(page);
    await mockWardrobeApi(page);
    await page.goto('/wardrobe');

    const sidebar = page.locator('nav');
    await expect(sidebar.getByRole('button', { name: '添加衣物' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: '添加衣物' })).toHaveCount(0);

    const addButton = page.getByRole('button', { name: '添加衣物' });
    await expect(addButton).toBeVisible();
    await expect(page.getByRole('button', { name: '批量管理' })).toBeVisible();
    await addButton.click();
    await expect(page.getByRole('heading', { name: '添加衣物', exact: true })).toBeVisible();
    await expect(page.getByText('批量添加衣物')).toBeVisible();
  });
});
