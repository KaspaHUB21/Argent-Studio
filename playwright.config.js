import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.browser.spec.js',
  workers: 1,
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI
    ? [['line'], ['json', { outputFile: 'test-output/playwright.json' }]]
    : 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
