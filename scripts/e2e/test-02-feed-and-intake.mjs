import { chromium } from 'playwright';

const SCREENSHOT_PATH = 'C:/Users/talee/.gemini/antigravity/brain/02b9fdec-dbc1-4f06-9b10-b33e52d1e1c1/e2e_feed_verification.png';

async function run() {
  console.log('[Module 2: Feed & Job Intake] Starting...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 950 },
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [Console Error]:', msg.text());
  });

  try {
    // 1. Visit /jobs
    console.log('  Navigating to http://localhost:3000/jobs...');
    await page.goto('http://localhost:3000/jobs', { waitUntil: 'networkidle', timeout: 30000 });

    // Verify header title
    const headerTitle = page.locator('header p:has-text("Jobs")');
    await headerTitle.waitFor({ state: 'visible', timeout: 10000 });
    console.log('  ✓ Header displays "Jobs" title');

    // Verify tabs: Today's Best, Pipeline, Searches
    const todaysBestTab = page.locator('button[role="tab"]:has-text("Today\'s Best")');
    await todaysBestTab.waitFor({ state: 'visible' });
    console.log('  ✓ "Today\'s Best" tab visible');

    const pipelineTab = page.locator('button[role="tab"]:has-text("Pipeline")');
    await pipelineTab.waitFor({ state: 'visible' });
    console.log('  ✓ "Pipeline" tab visible');

    // Verify filter controls exist on feed
    const searchFilter = page.locator('input[placeholder*="Filter Today"], input[aria-label="Filter Today\'s Best"]');
    await searchFilter.waitFor({ state: 'visible', timeout: 5000 });
    console.log('  ✓ Feed search filter input rendered');

    // Verify feed item cards
    const feedCards = page.locator('[data-testid*="feed-card"], div[class*="rounded-xl border"][class*="transition-all"]');
    const cardCount = await feedCards.count();
    console.log(`  ✓ Feed cards found: ${cardCount}`);

    // Switch to Pipeline tab
    await pipelineTab.click();
    await page.waitForTimeout(600);
    const tableRows = page.locator('table tbody tr');
    const rowCount = await tableRows.count();
    console.log(`  ✓ Pipeline tab switched successfully. Table rows: ${rowCount}`);

    // Switch back to Today's Best tab
    await todaysBestTab.click();
    await page.waitForTimeout(600);

    // 2. Test Add a Job (/jobs/new)
    console.log('  Navigating to http://localhost:3000/jobs/new...');
    await page.goto('http://localhost:3000/jobs/new', { waitUntil: 'networkidle', timeout: 20000 });

    // Check title
    const newJobHeader = page.locator('header p:has-text("Add a job")');
    await newJobHeader.waitFor({ state: 'visible', timeout: 5000 });
    console.log('  ✓ Add a job page loaded with correct header title');

    // Check input fields
    const titleInput = page.locator('input#title, input[name="title"]');
    const companyInput = page.locator('input#company, input[name="company"]');
    await titleInput.waitFor({ state: 'visible', timeout: 5000 });
    await companyInput.waitFor({ state: 'visible', timeout: 5000 });
    console.log('  ✓ Job title and company form inputs are visible');

    // Fill new job details
    const uniqueTitle = `Staff AI Systems Architect ${Date.now()}`;
    await titleInput.fill(uniqueTitle);
    await companyInput.fill('Acme Corp');

    // Check location if exists
    const locationInput = page.locator('input#location, input[name="location"]');
    if (await locationInput.isVisible()) {
      await locationInput.fill('San Francisco, CA (Remote)');
    }

    // Fill description
    const descTextarea = page.locator('textarea#description, textarea[name="description"]');
    if (await descTextarea.isVisible()) {
      await descTextarea.fill('Leading our core distributed AI systems architecture, TypeScript/Python LLM agents, and scalable cloud deployment.');
    }

    // Click submit
    const submitBtn = page.locator('button[type="submit"]:has-text("Save job"), button[type="submit"]');
    await submitBtn.click();
    console.log('  ✓ Submitted new job form. Waiting for redirect to job detail...');
    await page.waitForURL((url) => url.pathname.startsWith('/jobs/') && url.pathname !== '/jobs/new', { timeout: 15000 });
    console.log(`  ✓ Successfully redirected to new job detail: ${page.url()}`);

    // Navigate back to /jobs to capture visual artifact
    await page.goto('http://localhost:3000/jobs', { waitUntil: 'networkidle', timeout: 20000 });
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    console.log(`  ✓ Feed screenshot saved to ${SCREENSHOT_PATH}`);

    console.log('[Module 2: Feed & Job Intake] ALL CHECKS PASSED!\n');
    return true;
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('[Module 2: Feed & Job Intake] FAILED:', err);
  process.exit(1);
});
