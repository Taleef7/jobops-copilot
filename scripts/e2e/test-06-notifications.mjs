import { chromium } from 'playwright';

const SCREENSHOT_PATH = 'C:/Users/talee/.gemini/antigravity/brain/02b9fdec-dbc1-4f06-9b10-b33e52d1e1c1/e2e_notifications_verification.png';

async function run() {
  console.log('[Module 6: Alerts & Notifications] Starting...');

  // 1. Dispatch a fresh test notification to verify API pipeline
  const testRes = await fetch('http://localhost:4000/api/notifications/test', {
    method: 'POST',
    headers: { 'x-user-id': 'user_local_dev', 'Content-Type': 'application/json' },
  });
  if (testRes.ok) {
    const data = await testRes.json();
    console.log(`  ✓ Created test notification: "${data.notification?.title}"`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [Console Error]:', msg.text());
  });

  try {
    // 2. Visit /dashboard to verify global header bell
    console.log('  Navigating to http://localhost:3000/dashboard...');
    await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle', timeout: 30000 });

    const bellBtn = page.locator('[data-testid="notifications-bell-button"]');
    await bellBtn.waitFor({ state: 'visible', timeout: 10000 });
    console.log('  ✓ Notifications bell button is visible in header');

    const badge = page.locator('[data-testid="notifications-badge"]');
    if (await badge.isVisible()) {
      const badgeText = await badge.innerText();
      console.log(`  ✓ Unread notifications badge count: ${badgeText}`);
    }

    // Click bell button to open dropdown
    await bellBtn.click();
    const dropdown = page.locator('[data-testid="notifications-dropdown"]');
    await dropdown.waitFor({ state: 'visible', timeout: 5000 });
    console.log('  ✓ Notifications dropdown popover opened');

    // 3. Visit /settings to test Notification preferences
    console.log('  Navigating to http://localhost:3000/settings...');
    await page.goto('http://localhost:3000/settings', { waitUntil: 'networkidle', timeout: 30000 });

    const notifManager = page.locator('[data-testid="notification-settings-manager"]');
    await notifManager.scrollIntoViewIfNeeded();
    await notifManager.waitFor({ state: 'visible', timeout: 10000 });
    console.log('  ✓ Notification preferences SectionCard is visible');

    // Verify switches
    const inAppSwitch = page.locator('[data-testid="switch-channel-inapp"]');
    const emailSwitch = page.locator('[data-testid="switch-channel-email"]');
    const telegramSwitch = page.locator('[data-testid="switch-channel-telegram"]');
    const webPushSwitch = page.locator('[data-testid="switch-channel-webpush"]');
    await inAppSwitch.waitFor({ state: 'visible' });
    await emailSwitch.waitFor({ state: 'visible' });
    await telegramSwitch.waitFor({ state: 'visible' });
    await webPushSwitch.waitFor({ state: 'visible' });
    console.log('  ✓ All 4 delivery channel switches rendered');

    // Verify trigger sliders & digest selectors
    const scoreRange = page.locator('[data-testid="range-min-match-score"]');
    const digestSelect = page.locator('[data-testid="select-digest-hour"]');
    await scoreRange.waitFor({ state: 'visible' });
    await digestSelect.waitFor({ state: 'visible' });
    console.log('  ✓ Match score threshold and digest hour controls rendered');

    // Click "Send test notification"
    const sendTestBtn = page.locator('[data-testid="btn-send-test-notification"]');
    await sendTestBtn.click();
    console.log('  ✓ Clicked "Send test notification"');
    await page.waitForTimeout(1000);

    // Click "Save preferences"
    const saveBtn = page.locator('[data-testid="btn-save-notification-settings"]');
    await saveBtn.click();
    console.log('  ✓ Clicked "Save preferences"');
    await page.waitForTimeout(1000);

    // Open bell in header on Settings page
    await bellBtn.click();
    await dropdown.waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(800);

    // Capture screenshot
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    console.log(`  ✓ Notifications screenshot saved to ${SCREENSHOT_PATH}`);

    console.log('[Module 6: Alerts & Notifications] ALL CHECKS PASSED!\n');
    return true;
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('[Module 6: Alerts & Notifications] FAILED:', err);
  process.exit(1);
});
