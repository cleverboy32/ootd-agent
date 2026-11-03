import { expect, test } from '@playwright/test';
import { mockLoggedIn } from '../helpers/mock-session';
import { mockProfileApi } from '../helpers/mock-apis';

test.describe('profile display', () => {
  test('[ACC-P1] profile page loads mock profile data', async ({ page }) => {
    await mockLoggedIn(page);
    await mockProfileApi(page);
    await page.goto('/profile');

    await expect(page.getByText('E2E Tester')).toBeVisible();
    await expect(page.getByText('170')).toBeVisible();
  });
});
