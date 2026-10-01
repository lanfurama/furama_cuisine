import { defineConfig, devices } from '@playwright/test';

/**
 * Visual-regression project. Runs against an already-running production build
 * (`next build && next start -p $PORT`), never `next dev` (dev overlay/indicators).
 * Local only: baselines are macOS renderings. See e2e/visual.spec.ts.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /\/visual[^/]*\.spec\.ts$/,
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  // No OS suffix and no URL in the file name: files are named by logical page.
  snapshotPathTemplate: '{testDir}/__visual__/{projectName}/{arg}{ext}',
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0 } },
  use: { baseURL: process.env.VISUAL_BASE_URL ?? 'http://localhost:3100' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
    { name: 'phone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
});
