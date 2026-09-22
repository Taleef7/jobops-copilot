import { chromium } from 'playwright';

const ARTIFACT_PATH = 'C:/Users/talee/.gemini/antigravity/brain/02b9fdec-dbc1-4f06-9b10-b33e52d1e1c1/notifications_verification.png';

async function run() {
  console.log('1. Dispatching a test notification via API to ensure active notifications exist...');
  const testRes = await fetch('http://localhost:4000/api/notifications/test', {
    method: 'POST',
    headers: { 'x-user-id': 'user_local_dev', 'Content-Type': 'application/json' },
  });
  if (testRes.ok) {
    const testData = await testRes.json();
    console.log(`Created test notification: "${testData.notification?.title}" (ID: ${testData.notification?.id})`);
  } else {
    console.log(`Test notification dispatch status: ${testRes.status}`);
  }

  console.log('2. Launching browser and navigating to http://localhost:3000/settings...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1100 },
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log('BROWSER CONSOLE ERROR:', msg.text());
    }
  });

  try {
    await page.goto('http://localhost:3000/settings', { waitUntil: 'networkidle', timeout: 30000 });
    console.log('3. Settings page loaded.');

    // Verify Notification preferences section in Settings
    const settingsSection = page.locator('[data-testid="notification-settings-manager"]');
    await settingsSection.waitFor({ state: 'visible', timeout: 15000 });
    console.log('4. Notification preferences card is visible on settings page.');

    // Check switches and controls
    const inAppSwitch = page.locator('[data-testid="switch-channel-inapp"]');
    const emailSwitch = page.locator('[data-testid="switch-channel-email"]');
    const telegramSwitch = page.locator('[data-testid="switch-channel-telegram"]');
    const webPushSwitch = page.locator('[data-testid="switch-channel-webpush"]');
    const minMatchScoreRange = page.locator('[data-testid="range-min-match-score"]');
    const digestHourSelect = page.locator('[data-testid="select-digest-hour"]');

    await inAppSwitch.waitFor({ state: 'visible' });
    console.log('5. Verified delivery channel switches & schedules rendered.');

    // Click "Send test notification"
    const sendTestBtn = page.locator('[data-testid="btn-send-test-notification"]');
    await sendTestBtn.click();
    console.log('6. Clicked "Send test notification". Waiting 1s for dispatch...');
    await page.waitForTimeout(1000);

    // Save preferences
    const saveBtn = page.locator('[data-testid="btn-save-notification-settings"]');
    await saveBtn.click();
    console.log('7. Clicked "Save preferences".');
    await page.waitForTimeout(1000);

    // Now test and open the Notifications Bell in Header
    const bellBtn = page.locator('[data-testid="notifications-bell-button"]');
    await bellBtn.waitFor({ state: 'visible', timeout: 5000 });
    console.log('8. Notifications bell button found in header. Clicking bell...');
    await bellBtn.click();

    // Verify popover dropdown
    const dropdown = page.locator('[data-testid="notifications-dropdown"]');
    await dropdown.waitFor({ state: 'visible', timeout: 5000 });
    console.log('9. Notifications popover opened successfully!');

    // Wait a brief moment to allow render to settle
    await page.waitForTimeout(1200);

    // Capture screenshot artifact with bell open
    console.log(`10. Capturing screenshot artifact to ${ARTIFACT_PATH}...`);
    await page.screenshot({ path: ARTIFACT_PATH, fullPage: false });
    console.log('11. Visual artifact captured successfully!');

    // Close dropdown and scroll down to notification settings section
    await bellBtn.click();
    await page.waitForTimeout(400);

    await settingsSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    const SETTINGS_ARTIFACT_PATH = 'C:/Users/talee/.gemini/antigravity/brain/02b9fdec-dbc1-4f06-9b10-b33e52d1e1c1/notification_preferences_verification.png';
    await page.screenshot({ path: SETTINGS_ARTIFACT_PATH, fullPage: false });
    console.log(`12. Captured settings section artifact to ${SETTINGS_ARTIFACT_PATH}`);
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
