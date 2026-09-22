import { chromium } from 'playwright';

const SCREENSHOT_PATH = 'C:/Users/talee/.gemini/antigravity/brain/02b9fdec-dbc1-4f06-9b10-b33e52d1e1c1/e2e_assistant_reports_verification.png';

async function run() {
  console.log('[Module 7: Assistant Copilot & Weekly Reports] Starting...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [Console Error]:', msg.text());
  });

  try {
    // 1. Visit /assistant
    console.log('  Navigating to http://localhost:3000/assistant...');
    await page.goto('http://localhost:3000/assistant', { waitUntil: 'networkidle', timeout: 30000 });

    const assistantTitle = page.locator('header p:has-text("Assistant")');
    await assistantTitle.waitFor({ state: 'visible', timeout: 10000 });
    console.log('  ✓ Assistant header title verified');

    const runSection = page.locator('text=Run the assistant');
    await runSection.waitFor({ state: 'visible', timeout: 5000 });
    console.log('  ✓ Run the assistant panel visible');

    // 2. Visit /reports
    console.log('  Navigating to http://localhost:3000/reports...');
    await page.goto('http://localhost:3000/reports', { waitUntil: 'networkidle', timeout: 30000 });

    const reportsTitle = page.locator('header p:has-text("Weekly reports")');
    await reportsTitle.waitFor({ state: 'visible', timeout: 10000 });
    console.log('  ✓ Reports header title verified');

    const pipelineSubtitle = page.locator('text=A live snapshot of your pipeline');
    await pipelineSubtitle.waitFor({ state: 'visible', timeout: 5000 });
    console.log('  ✓ Reports subtitle verified');

    // Verify stat tiles render (Discovered, Applied, Outreach sent, Interviews)
    const statTile = page.locator('text=Discovered').first();
    await statTile.waitFor({ state: 'visible', timeout: 5000 });
    console.log('  ✓ Pipeline stat tiles rendered');

    // Capture screenshot
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    console.log(`  ✓ Assistant & reports screenshot saved to ${SCREENSHOT_PATH}`);

    console.log('[Module 7: Assistant Copilot & Weekly Reports] ALL CHECKS PASSED!\n');
    return true;
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('[Module 7: Assistant Copilot & Weekly Reports] FAILED:', err);
  process.exit(1);
});
