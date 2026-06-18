import { defineConfig, devices } from '@playwright/test';

// Smoke e2e for the web app's public surface (Phase 5 · U). The Next.js app needs
// Clerk keys to boot (ClerkProvider + clerkMiddleware), so these run locally with
// apps/web/.env.local; in CI they run only when Clerk secrets are configured.
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Start the dev server unless E2E_BASE_URL points at an already-running target.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
