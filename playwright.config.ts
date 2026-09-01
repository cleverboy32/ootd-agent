import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve('.env') });
dotenv.config({ path: path.resolve('.env.local'), override: true });

const chromeUse = {
  ...devices['Desktop Chrome'],
  channel: 'chrome' as const,
};

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['./tests/e2e/reporters/acceptance-markdown-reporter.ts'],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'mock',
      testIgnore: '**/acceptance-live/**',
      use: chromeUse,
    },
    {
      name: 'live',
      testMatch: '**/acceptance-live/**/*.spec.ts',
      timeout: 180_000,
      fullyParallel: false,
      workers: 1,
      use: chromeUse,
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
