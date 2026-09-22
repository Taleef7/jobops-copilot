import { chromium } from 'playwright';

const SCREENSHOT_PATH = 'C:/Users/talee/.gemini/antigravity/brain/02b9fdec-dbc1-4f06-9b10-b33e52d1e1c1/e2e_apply_copilot_verification.png';

async function run() {
  console.log('[Module 4: Apply Copilot & Extension] Starting...');

  // 1. Get a valid job ID from API
  const jobsRes = await fetch('http://localhost:4000/api/jobs', {
    headers: { 'x-user-id': 'user_local_dev' },
  });
  const jobsData = await jobsRes.json();
  const job = jobsData.jobs?.[0];
  if (!job) throw new Error('No jobs found in API store for Apply Copilot testing');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [Console Error]:', msg.text());
  });

  try {
    // 2. Visit /jobs/[jobId] to test Application Pack tab
    const jobUrl = `http://localhost:3000/jobs/${job.id}`;
    console.log(`  Navigating to job detail: ${jobUrl}...`);
    await page.goto(jobUrl, { waitUntil: 'networkidle', timeout: 30000 });

    const applyPackTab = page.locator('button[role="tab"]:has-text("Apply pack")');
    await applyPackTab.waitFor({ state: 'visible', timeout: 10000 });
    await applyPackTab.click();
    console.log('  ✓ Clicked "Apply pack" tab');
    await page.waitForTimeout(600);

    // If pack is not yet assembled, click Generate Application Pack
    const generatePackBtn = page.locator('button:has-text("Generate Application Pack")');
    if (await generatePackBtn.isVisible()) {
      console.log('  Clicking "Generate Application Pack"...');
      await generatePackBtn.click();
      await page.locator('text=Ready for autofill').waitFor({ state: 'visible', timeout: 20000 });
      console.log('  ✓ Application pack assembled successfully!');
    } else {
      console.log('  ✓ Application pack already assembled and visible');
    }

    // Verify Q&A memory / answers section
    const answersHeader = page.locator('text=Ready for autofill');
    await answersHeader.waitFor({ state: 'visible', timeout: 10000 });
    console.log('  ✓ Application pack view loaded successfully');

    // 3. Visit /settings to test Extension PAT Management
    console.log('  Navigating to http://localhost:3000/settings...');
    await page.goto('http://localhost:3000/settings', { waitUntil: 'networkidle', timeout: 30000 });

    const tokensSection = page.locator('text=Chrome extension access tokens');
    await tokensSection.scrollIntoViewIfNeeded();
    await tokensSection.waitFor({ state: 'visible', timeout: 10000 });
    console.log('  ✓ Extension tokens card visible in Settings');

    // Generate new token
    const tokenInput = page.locator('input[placeholder*="Work Laptop Chrome"]');
    const generateTokenBtn = page.locator('button:has-text("Generate new token")');
    await tokenInput.waitFor({ state: 'visible', timeout: 5000 });
    await tokenInput.fill('E2E Test Runner Token');
    await generateTokenBtn.click();
    console.log('  ✓ Generated new personal access token');
    await page.waitForTimeout(1000);

    // Verify new token item is rendered
    const tokenItem = page.locator('text=E2E Test Runner Token').first();
    await tokenItem.waitFor({ state: 'visible', timeout: 10000 });
    console.log('  ✓ Verified token item rendered in tokens list');

    // Revoke the test token
    const revokeBtn = page.locator('div:has-text("E2E Test Runner Token") button[title*="Revoke"], div:has-text("E2E Test Runner Token") button:has-text("Revoke")').first();
    if (await revokeBtn.isVisible()) {
      await revokeBtn.click();
      console.log('  ✓ Clicked Revoke token');
      await page.waitForTimeout(800);
    }

    // Navigate back to job detail apply-pack tab for visual artifact
    await page.goto(jobUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.locator('button[role="tab"]:has-text("Apply pack")').click();
    await page.waitForTimeout(800);

    // Capture screenshot
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    console.log(`  ✓ Apply copilot screenshot saved to ${SCREENSHOT_PATH}`);

    console.log('[Module 4: Apply Copilot & Extension] ALL CHECKS PASSED!\n');
    return true;
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('[Module 4: Apply Copilot & Extension] FAILED:', err);
  process.exit(1);
});
