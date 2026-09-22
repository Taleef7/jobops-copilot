import { chromium } from 'playwright';

const SCREENSHOT_PATH = 'C:/Users/talee/.gemini/antigravity/brain/02b9fdec-dbc1-4f06-9b10-b33e52d1e1c1/e2e_resume_studio_verification.png';

async function run() {
  console.log('[Module 3: Resume Studio & ATS PDFs] Starting...');

  // 1. Get a valid job ID from API
  const jobsRes = await fetch('http://localhost:4000/api/jobs', {
    headers: { 'x-user-id': 'user_local_dev' },
  });
  const jobsData = await jobsRes.json();
  const job = jobsData.jobs?.[0];
  if (!job) throw new Error('No jobs found in API store for Resume Studio testing');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [Console Error]:', msg.text());
  });

  try {
    // 2. Visit /settings to verify Base Resume Editor
    console.log('  Navigating to http://localhost:3000/settings...');
    await page.goto('http://localhost:3000/settings', { waitUntil: 'networkidle', timeout: 30000 });

    const baseResumeHeader = page.locator('text=Base resume (Structured)');
    await baseResumeHeader.waitFor({ state: 'visible', timeout: 10000 });
    console.log('  ✓ Base resume editor card visible');

    const nameInput = page.locator('input#basics-name, input[value*="Jane"]');
    await nameInput.waitFor({ state: 'visible', timeout: 5000 });
    console.log('  ✓ Base resume basics fields rendered');

    // 3. Visit /jobs/[jobId] to test Tailored Resume Studio
    const jobUrl = `http://localhost:3000/jobs/${job.id}`;
    console.log(`  Navigating to job detail: ${jobUrl}...`);
    await page.goto(jobUrl, { waitUntil: 'networkidle', timeout: 30000 });

    const resumeTab = page.locator('button[role="tab"]:has-text("Resume studio")');
    await resumeTab.waitFor({ state: 'visible', timeout: 10000 });
    await resumeTab.click();
    console.log('  ✓ Clicked "Resume studio" tab');
    await page.waitForTimeout(600);

    const approveBtn = page.locator('button:has-text("Approve Resume")');
    const downloadBtn = page.locator('button:has-text("Download ATS PDF"), a:has-text("Download ATS PDF")').first();
    const tailorBtn = page.locator('button:has-text("Tailor Resume"), button:has-text("Re-tailor")').first();

    if (await approveBtn.isVisible()) {
      console.log('  ✓ Tailored resume version found pending approval!');
      await approveBtn.click();
      console.log('  ✓ Clicked "Approve Resume". Waiting for PDF unlock...');
      await page.waitForTimeout(1000);
      await downloadBtn.waitFor({ state: 'visible', timeout: 10000 });
      console.log('  ✓ ATS PDF download is unlocked and verified!');
    } else if (await downloadBtn.isVisible()) {
      console.log('  ✓ Tailored resume version is already approved and ATS PDF download is ready!');
      if (await tailorBtn.isVisible()) {
        console.log('  Testing "Re-tailor" action...');
        await tailorBtn.click();
        await approveBtn.waitFor({ state: 'visible', timeout: 20000 });
        console.log('  ✓ New version generated and pending approval!');
        await approveBtn.click();
        await page.waitForTimeout(1000);
        await downloadBtn.waitFor({ state: 'visible', timeout: 10000 });
        console.log('  ✓ Re-tailored version approved and download unlocked!');
      }
    } else {
      await tailorBtn.waitFor({ state: 'visible', timeout: 10000 });
      console.log('  ✓ Tailor resume action button is visible. Triggering tailor run...');
      await tailorBtn.click();
      await approveBtn.waitFor({ state: 'visible', timeout: 20000 });
      console.log('  ✓ Tailored resume generated! Approve Resume button is active.');
      await approveBtn.click();
      await page.waitForTimeout(1000);
      await downloadBtn.waitFor({ state: 'visible', timeout: 10000 });
      console.log('  ✓ ATS PDF download is unlocked and verified!');
    }

    // Capture screenshot
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    console.log(`  ✓ Resume studio screenshot saved to ${SCREENSHOT_PATH}`);

    console.log('[Module 3: Resume Studio & ATS PDFs] ALL CHECKS PASSED!\n');
    return true;
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('[Module 3: Resume Studio & ATS PDFs] FAILED:', err);
  process.exit(1);
});
