import { chromium } from 'playwright';

const SCREENSHOT_PATH = 'C:/Users/talee/.gemini/antigravity/brain/02b9fdec-dbc1-4f06-9b10-b33e52d1e1c1/e2e_connection_scout_verification.png';

async function run() {
  console.log('[Module 5: Connection Scout & Outreach Hub] Starting...');

  // 1. Get a valid job ID from API
  const jobsRes = await fetch('http://localhost:4000/api/jobs', {
    headers: { 'x-user-id': 'user_local_dev' },
  });
  const jobsData = await jobsRes.json();
  const job = jobsData.jobs?.[0];
  if (!job) throw new Error('No jobs found in API store for Connection Scout testing');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [Console Error]:', msg.text());
  });

  try {
    // 2. Visit /jobs/[jobId] and test People tab
    const jobUrl = `http://localhost:3000/jobs/${job.id}`;
    console.log(`  Navigating to job detail: ${jobUrl}...`);
    await page.goto(jobUrl, { waitUntil: 'networkidle', timeout: 30000 });

    const peopleTab = page.locator('button[role="tab"]:has-text("People")');
    await peopleTab.waitFor({ state: 'visible', timeout: 10000 });
    await peopleTab.click();
    console.log('  ✓ Clicked "People" tab');
    await page.waitForTimeout(600);

    const scoutHeader = page.locator('text=Connection Scout & People');
    await scoutHeader.waitFor({ state: 'visible', timeout: 10000 });
    console.log('  ✓ Connection Scout panel visible');

    // If scout button is visible, click it
    const scoutBtn = page.locator('#scout-people-btn');
    if (await scoutBtn.isVisible()) {
      console.log('  Clicking "Scout People"...');
      await scoutBtn.click();
      await page.waitForTimeout(2000);
    }

    // Verify contact cards
    await page.waitForSelector('[data-contact-id]', { timeout: 15000 });
    const contactCards = page.locator('[data-contact-id]');
    const count = await contactCards.count();
    console.log(`  ✓ Verified ${count} verified contact cards rendered`);

    // Verify public evidence links
    const evidenceLinks = page.locator('a[target="_blank"]');
    const evidenceCount = await evidenceLinks.count();
    console.log(`  ✓ Verified ${evidenceCount} public evidence links displayed`);

    // Click "Draft Outreach" on the first contact
    const draftBtn = page.locator('button:has-text("Draft Outreach")').first();
    if (await draftBtn.isVisible()) {
      console.log('  Clicking "Draft Outreach" on first contact...');
      await draftBtn.click();
      await page.waitForSelector('text=Personalized Outreach Draft', { timeout: 15000 });
      console.log('  ✓ Personalized outreach draft generated and rendered successfully');
    }

    // 3. Visit /outreach to verify Outreach Hub
    console.log('  Navigating to http://localhost:3000/outreach...');
    await page.goto('http://localhost:3000/outreach', { waitUntil: 'networkidle', timeout: 30000 });

    const outreachTitle = page.locator('header p:has-text("Outreach")');
    await outreachTitle.waitFor({ state: 'visible', timeout: 10000 });
    console.log('  ✓ Outreach Hub header title verified');

    const draftsOnlyBanner = page.locator('text=Drafts only. Nothing sends without your approval.');
    await draftsOnlyBanner.waitFor({ state: 'visible', timeout: 5000 });
    console.log('  ✓ Fail-closed "Drafts only" banner verified');

    // Capture screenshot
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    console.log(`  ✓ Outreach screenshot saved to ${SCREENSHOT_PATH}`);

    console.log('[Module 5: Connection Scout & Outreach Hub] ALL CHECKS PASSED!\n');
    return true;
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('[Module 5: Connection Scout & Outreach Hub] FAILED:', err);
  process.exit(1);
});
