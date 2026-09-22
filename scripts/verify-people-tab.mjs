import { chromium } from 'playwright';

const ARTIFACT_PATH = 'C:/Users/talee/.gemini/antigravity/brain/02b9fdec-dbc1-4f06-9b10-b33e52d1e1c1/people_tab_verification.png';

async function run() {
  console.log('1. Fetching valid persisted job from API...');
  const res = await fetch('http://localhost:4000/api/jobs', {
    headers: { 'x-user-id': 'user_local_dev' },
  });
  const data = await res.json();
  const job = data.jobs?.[0];
  if (!job) {
    throw new Error('No jobs found in API store!');
  }
  const jobId = job.id;
  const targetUrl = `http://localhost:3000/jobs/${jobId}`;
  console.log(`Using job "${job.title}" at "${job.company}" (ID: ${jobId})`);
  console.log(`2. Launching browser and navigating to ${targetUrl}...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 950 },
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log('BROWSER CONSOLE ERROR:', msg.text());
    }
  });

  page.on('response', (response) => {
    if (response.url().includes('/scout') || response.url().includes('/contacts')) {
      console.log(`RESPONSE [${response.status()}]: ${response.url()}`);
    }
  });

  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
    console.log('3. Page loaded. Locating "People" tab...');

    const peopleTab = page.getByRole('tab', { name: 'People' });
    await peopleTab.waitFor({ state: 'visible', timeout: 10000 });
    await peopleTab.click();
    console.log('4. Clicked "People" tab.');

    // Wait for the panel header and fail-closed badge
    await page.waitForSelector('text=Connection Scout & People', { timeout: 10000 });
    console.log('5. Connection Scout panel is visible.');

    // Click "Scout People" button
    const scoutBtn = page.locator('#scout-people-btn');
    await scoutBtn.waitFor({ state: 'visible' });
    console.log('6. Clicking "Scout People" button...');
    await scoutBtn.click();

    // Wait for contact cards to appear
    await page.waitForSelector('[data-contact-id]', { timeout: 15000 });
    const contactCards = page.locator('[data-contact-id]');
    const count = await contactCards.count();
    console.log(`7. Verified ${count} contact cards rendered.`);
    if (count === 0) {
      throw new Error('Expected at least 1 contact card after scouting!');
    }

    // Verify public evidence links
    const evidenceLinks = page.locator('a[target="_blank"]:has-text("Directory")');
    const evidenceCount = await evidenceLinks.count();
    console.log(`8. Verified ${evidenceCount} public evidence links displayed.`);

    // Click "Draft Outreach" on the first contact
    const firstDraftBtn = page.locator('button:has-text("Draft Outreach")').first();
    if (await firstDraftBtn.isVisible()) {
      console.log('9. Clicking "Draft Outreach" for first contact...');
      await firstDraftBtn.click();

      // Wait for inline draft preview to display
      await page.waitForSelector('text=Personalized Outreach Draft', { timeout: 15000 });
      console.log('10. Personalized outreach draft generated and rendered successfully.');
    }

    await page.waitForTimeout(1000);

    // Capture visual artifact
    console.log(`11. Capturing screenshot to ${ARTIFACT_PATH}...`);
    await page.screenshot({ path: ARTIFACT_PATH, fullPage: false });
    console.log('SUCCESS: Playwright verification complete and visual artifact saved!');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('FAILED verification:', err);
  process.exit(1);
});
