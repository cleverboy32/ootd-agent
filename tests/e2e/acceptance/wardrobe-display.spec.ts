import { expect, test } from '@playwright/test';
import { mockLoggedIn } from '../helpers/mock-session';
import { mockWardrobeApi } from '../helpers/mock-apis';

test.describe('wardrobe display', () => {
  test.beforeEach(async ({ page }) => {
    await mockWardrobeApi(page);
  });

  test('[ACC-W1] loads wardrobe items with subCategory labels', async ({ page }) => {
    await mockLoggedIn(page);
    await page.goto('/wardrobe');

    await expect(page.getByText('共 2 件衣物')).toBeVisible();
    await expect(page.getByText('Button-Up Shirt')).toBeVisible();
    await expect(page.getByText('Wide-Leg Trousers')).toBeVisible();
  });

  test('[ACC-W2] category tab filters by mainCategory', async ({ page }) => {
    await mockLoggedIn(page);
    await page.goto('/wardrobe');

    await page.getByRole('tab', { name: '下装' }).click();
    await expect(page.getByText('Wide-Leg Trousers')).toBeVisible();
    await expect(page.getByText('Button-Up Shirt')).toBeHidden();
  });

  test('[ACC-W4] logged-in mode shows batch manage button', async ({ page }) => {
    await mockLoggedIn(page);
    await page.goto('/wardrobe');

    await expect(page.getByRole('button', { name: '批量管理' })).toBeVisible();
    await expect(page.getByRole('button', { name: '添加衣物' })).toBeVisible();
  });
});
