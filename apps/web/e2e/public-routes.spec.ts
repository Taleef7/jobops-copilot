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
    expect((await page.title()).trim(), `non-empty <title> for ${route}`).not.toEqual('');
    expect(pageErrors, `uncaught page errors on ${route}`).toEqual([]);
  });
}

// #347: every page carries the security headers, and none advertises Next.js.
for (const route of publicRoutes) {
  test(`public route ${route} sends the security headers`, async ({ request }) => {
    const response = await request.get(route);
    const headers = response.headers();

    expect(headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toBe('camera=(), geolocation=(), microphone=()');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy-report-only']).toContain('report-uri /api/csp-report');
    expect(headers['x-powered-by']).toBeUndefined();
  });
}

test('CSP reports are accepted from a signed-out page', async ({ request }) => {
  const response = await request.post('/api/csp-report', {
    headers: { 'content-type': 'application/csp-report' },
    data: JSON.stringify({ 'csp-report': { 'document-uri': 'http://localhost/', 'effective-directive': 'img-src', 'blocked-uri': 'data' } }),
  });
  expect(response.status()).toBe(204);
});

test('a protected route redirects an unauthenticated visitor to sign-in', async ({ page }) => {
  await page.goto('/dashboard');
  // clerkMiddleware `auth.protect()` bounces unauthenticated users to the sign-in flow.
  await page.waitForURL(/sign-in/, { timeout: 20_000 });
  expect(page.url()).toContain('sign-in');
});
