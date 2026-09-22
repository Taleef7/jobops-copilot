import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ARTIFACT_DIR = 'C:/Users/talee/.gemini/antigravity/brain/02b9fdec-dbc1-4f06-9b10-b33e52d1e1c1';

const SUITES = [
  {
    name: 'Module 1: Dashboard & App Navigation',
    script: join(__dirname, 'test-01-dashboard.mjs'),
    screenshot: join(ARTIFACT_DIR, 'e2e_dashboard_verification.png'),
  },
  {
    name: 'Module 2: Scored Feed & Job Intake (Epic 2)',
    script: join(__dirname, 'test-02-feed-and-intake.mjs'),
    screenshot: join(ARTIFACT_DIR, 'e2e_feed_verification.png'),
  },
  {
    name: 'Module 3: Resume Studio & ATS PDFs (Epic 4)',
    script: join(__dirname, 'test-03-resume-studio.mjs'),
    screenshot: join(ARTIFACT_DIR, 'e2e_resume_studio_verification.png'),
  },
  {
    name: 'Module 4: Apply Copilot & Extension (Epic 5)',
    script: join(__dirname, 'test-04-apply-copilot.mjs'),
    screenshot: join(ARTIFACT_DIR, 'e2e_apply_copilot_verification.png'),
  },
  {
    name: 'Module 5: Connection Scout & Outreach (Epic 6)',
    script: join(__dirname, 'test-05-connection-scout.mjs'),
    screenshot: join(ARTIFACT_DIR, 'e2e_connection_scout_verification.png'),
  },
  {
    name: 'Module 6: Alerts & Notifications (Epic 3)',
    script: join(__dirname, 'test-06-notifications.mjs'),
    screenshot: join(ARTIFACT_DIR, 'e2e_notifications_verification.png'),
  },
  {
    name: 'Module 7: Assistant Copilot & Weekly Reports',
    script: join(__dirname, 'test-07-assistant-and-reports.mjs'),
    screenshot: join(ARTIFACT_DIR, 'e2e_assistant_reports_verification.png'),
  },
];

async function runSuite(suite) {
  const start = Date.now();
  console.log(`\n===============================================================`);
  console.log(`RUNNING: ${suite.name}`);
  console.log(`===============================================================`);

  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [suite.script], {
      stdio: 'inherit',
      env: process.env,
    });

    proc.on('close', (code) => {
      const durationMs = Date.now() - start;
      const screenshotExists = existsSync(suite.screenshot);
      resolve({
        name: suite.name,
        code,
        passed: code === 0,
        durationMs,
        screenshot: suite.screenshot,
        screenshotExists,
      });
    });
  });
}

async function main() {
  console.log('Starting JobOps Copilot Full E2E Playwright Verification Suite...');
  const overallStart = Date.now();
  const results = [];

  for (const suite of SUITES) {
    const result = await runSuite(suite);
    results.push(result);
    if (!result.passed) {
      console.error(`❌ ${suite.name} FAILED with exit code ${result.code}`);
    }
  }

  const overallDuration = ((Date.now() - overallStart) / 1000).toFixed(1);
  console.log(`\n\n===============================================================`);
  console.log(`            CONSOLIDATED E2E VERIFICATION REPORT                `);
  console.log(`===============================================================`);

  let allPassed = true;
  for (const r of results) {
    const status = r.passed ? '✅ PASSED' : '❌ FAILED';
    const screenshotStatus = r.screenshotExists ? '📸 Screenshot Captured' : '⚠️ No Screenshot';
    console.log(`${status} | ${(r.durationMs / 1000).toFixed(1)}s | ${r.name}`);
    console.log(`        └─ ${screenshotStatus}`);
    if (!r.passed) allPassed = false;
  }

  console.log(`---------------------------------------------------------------`);
  console.log(`Total Duration: ${overallDuration}s`);
  console.log(`Total Suites: ${results.length} | Passed: ${results.filter(r => r.passed).length} | Failed: ${results.filter(r => !r.passed).length}`);
  console.log(`===============================================================\n`);

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
