import { expect, test } from '@playwright/test';
import { mockBrowseAccess } from '../helpers/mock-access';
import { mockProfileApi } from '../helpers/mock-apis';

test.describe('profile display', () => {
  test('[ACC-P1] profile page loads mock profile data', async ({ page }) => {
    await mockBrowseAccess(page);
    await mockProfileApi(page);
    await page.goto('/profile');

    await expect(page.getByText('E2E Tester')).toBeVisible();
    await expect(page.getByText('170')).toBeVisible();
  });
});
