import { defineConfig, devices } from '@playwright/test';
import type { FixtureOptions } from './tests/e2e/support/fixtures';

const CI = !!process.env.CI;

export default defineConfig<FixtureOptions>({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: CI ? 2 : 3,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  outputDir: 'test-results',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ...(CI ? [['github'] as const] : []),
  ],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'desktop-en-light',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        colorScheme: 'light',
        uiLocale: 'en',
      },
    },
    {
      name: 'desktop-ur-dark',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        colorScheme: 'dark',
        uiLocale: 'ur',
      },
    },
    {
      name: 'mobile-en-dark',
      use: { ...devices['Pixel 7'], colorScheme: 'dark', uiLocale: 'en' },
    },
    {
      name: 'mobile-ur-light',
      use: { ...devices['Pixel 7'], colorScheme: 'light', uiLocale: 'ur' },
    },
  ],
});
