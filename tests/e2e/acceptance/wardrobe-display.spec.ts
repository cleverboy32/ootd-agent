import { expect, test } from '@playwright/test';
import { mockBrowseAccess, mockVerifiedAccess } from '../helpers/mock-access';
import { mockWardrobeApi } from '../helpers/mock-apis';

test.describe('wardrobe display', () => {
  test.beforeEach(async ({ page }) => {
    await mockWardrobeApi(page);
  });

  test('[ACC-W1] loads wardrobe items with subCategory labels', async ({ page }) => {
    await mockBrowseAccess(page);
    await page.goto('/wardrobe');

    await expect(page.getByText('共 2 件衣物')).toBeVisible();
    await expect(page.getByText('Button-Up Shirt')).toBeVisible();
    await expect(page.getByText('Wide-Leg Trousers')).toBeVisible();
  });

  test('[ACC-W2] category tab filters by mainCategory', async ({ page }) => {
    await mockBrowseAccess(page);
    await page.goto('/wardrobe');

    await page.getByRole('tab', { name: '下装' }).click();
    await expect(page.getByText('Wide-Leg Trousers')).toBeVisible();
    await expect(page.getByText('Button-Up Shirt')).toBeHidden();
  });

  test('[ACC-W3] browse mode is read-only without batch manage', async ({ page }) => {
    await mockBrowseAccess(page);
    await page.goto('/wardrobe');

    await expect(page.getByRole('button', { name: '批量管理' })).toBeHidden();
  });

  test('[ACC-W4] verified mode shows batch manage button', async ({ page }) => {
    await mockVerifiedAccess(page);
    await page.goto('/wardrobe');

    await expect(page.getByRole('button', { name: '批量管理' })).toBeVisible();
  });
});
