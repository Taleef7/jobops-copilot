import { expect, test } from '@playwright/test';

// The public surface per src/proxy.ts `isPublicRoute` — reachable without auth.
const publicRoutes = ['/', '/architecture', '/sign-in', '/sign-up'];

for (const route of publicRoutes) {
  test(`public route ${route} loads without auth`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const response = await page.goto(route, { waitUntil: 'domcontentloaded' });

    expect(response?.status(), `HTTP status for ${route}`).toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
    expect(await page.title(), `non-empty <title> for ${route}`).not.toEqual('');
    expect(pageErrors, `uncaught page errors on ${route}`).toEqual([]);
  });
}

test('a protected route redirects an unauthenticated visitor to sign-in', async ({ page }) => {
  await page.goto('/dashboard');
  // clerkMiddleware `auth.protect()` bounces unauthenticated users to the sign-in flow.
  await page.waitForURL(/sign-in/, { timeout: 20_000 });
  expect(page.url()).toContain('sign-in');
});
