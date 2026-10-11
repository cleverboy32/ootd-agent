import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve('.env') });
dotenv.config({ path: path.resolve('.env.local'), override: true });

/**
 * 登录体系 API 级 e2e：独立 dev server（AUTH_MODE=user，端口 3001），
 * 与主 playwright.config.ts（access 模式 UI 测试）互不影响。
 * 运行：pnpm test:e2e:auth
 */
export default defineConfig({
  testDir: './tests/e2e/auth',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3001',
    channel: 'chrome',
  },
  webServer: {
    command: 'AUTH_MODE=user USER_SESSION_SECRET=e2e-user-session-secret-at-least-32-chars pnpm dev -p 3001',
    url: 'http://localhost:3001',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
