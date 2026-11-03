import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  // 共有のローカル DB を使うため、E2E は直列に実行する
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
