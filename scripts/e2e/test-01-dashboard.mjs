import { chromium } from 'playwright';

const SCREENSHOT_PATH = 'C:/Users/talee/.gemini/antigravity/brain/02b9fdec-dbc1-4f06-9b10-b33e52d1e1c1/e2e_dashboard_verification.png';

async function run() {
  console.log('[Module 1: Dashboard & Navigation] Starting...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [Console Error]:', msg.text());
  });

  try {
    // 1. Visit /dashboard
    console.log('  Navigating to http://localhost:3000/dashboard...');
    await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle', timeout: 30000 });

    // Verify header title
    const headerTitle = page.locator('header p:has-text("Overview")');
    await headerTitle.waitFor({ state: 'visible', timeout: 10000 });
    console.log('  ✓ Header displays "Overview" title');

    // Verify sidebar navigation links
    const sidebar = page.locator('aside, [data-sidebar="sidebar"]');
    await sidebar.waitFor({ state: 'visible' });
    console.log('  ✓ Sidebar is visible');

    const navItems = ['Dashboard', 'Jobs', 'Outreach', 'Reports', 'Settings', 'Assistant'];
    for (const item of navItems) {
      const link = page.locator(`a:has-text("${item}")`).first();
      await link.waitFor({ state: 'visible', timeout: 5000 });
      console.log(`  ✓ Nav item "${item}" found`);
    }

    // Verify KPI / metric summary cards on Dashboard
    const statsCards = page.locator('div[class*="grid"] div[class*="rounded"]');
    const statsCount = await statsCards.count();
    console.log(`  ✓ Dashboard metric cards found: ${statsCount}`);

    // Verify global search bar in header (on non-/jobs page)
    const searchInput = page.locator('header input[type="search"]');
    await searchInput.waitFor({ state: 'visible', timeout: 5000 });
    console.log('  ✓ Global search bar is present in header');

    // Test typing a query in the search bar and submitting
    await searchInput.fill('Senior');
    await searchInput.press('Enter');
    await page.waitForURL(/jobs\?q=Senior/, { timeout: 10000 });
    console.log('  ✓ Search submission navigated correctly to /jobs?q=Senior');

    // Navigate back to /dashboard
    await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle', timeout: 20000 });

    // Capture visual artifact
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    console.log(`  ✓ Dashboard screenshot saved to ${SCREENSHOT_PATH}`);

    console.log('[Module 1: Dashboard & Navigation] ALL CHECKS PASSED!\n');
    return true;
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('[Module 1: Dashboard & Navigation] FAILED:', err);
  process.exit(1);
});
