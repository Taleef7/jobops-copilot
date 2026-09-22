import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const extDir = join(projectRoot, 'extensions', 'chrome');

const ARTIFACT_PATH = 'C:/Users/talee/.gemini/antigravity/brain/02b9fdec-dbc1-4f06-9b10-b33e52d1e1c1/ext_options_verification.png';

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json',
};

async function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = req.url?.split('?')[0] || '/';
      const filePath = join(extDir, urlPath.replace(/^\//, ''));
      const ext = extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const content = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        serverUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function run() {
  console.log('1. Creating a real PAT via API on http://localhost:4000/api/ext-tokens...');
  const createTokenRes = await fetch('http://localhost:4000/api/ext-tokens', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'user_playwright_test',
    },
    body: JSON.stringify({ label: 'Playwright Automated Chrome Extension' }),
  });

  if (!createTokenRes.ok) {
    throw new Error(`Failed to create PAT: ${createTokenRes.status} ${await createTokenRes.text()}`);
  }

  const { token, rawToken } = await createTokenRes.json();
  console.log(`Token created: ${token.id}, raw: ${rawToken.slice(0, 10)}...`);

  console.log('2. Starting static server for extension files...');
  const { serverUrl, close: closeServer } = await startStaticServer();

  console.log('3. Launching Playwright browser...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--allow-file-access-from-files'],
  });
  const context = await browser.newContext({
    viewport: { width: 900, height: 750 },
  });
  const page = await context.newPage();

  page.on('console', (msg) => console.log('[PAGE CONSOLE]', msg.text()));
  page.on('pageerror', (err) => console.log('[PAGE ERROR]', err));

  // Mock chrome.storage and chrome.runtime in the page context before scripts run
  await page.addInitScript(() => {
    const storageData = {};
    window.chrome = window.chrome || {};
    window.chrome.storage = {
      sync: {
        get: (keys, cb) => {
          const res = {};
          keys.forEach((k) => { res[k] = storageData[k]; });
          setTimeout(() => cb(res), 0);
        },
        set: (items, cb) => {
          Object.assign(storageData, items);
          setTimeout(() => { if (cb) cb(); }, 0);
        },
      },
      local: {
        get: (keys, cb) => {
          const res = {};
          keys.forEach((k) => { res[k] = storageData[k]; });
          setTimeout(() => cb(res), 0);
        },
        set: (items, cb) => {
          Object.assign(storageData, items);
          setTimeout(() => { if (cb) cb(); }, 0);
        },
      },
    };
    window.chrome.runtime = {
      openOptionsPage: () => {},
      lastError: null,
    };
  });

  const optionsUrl = `${serverUrl}/options/options.html`;
  console.log(`4. Navigating to options page: ${optionsUrl}...`);
  await page.goto(optionsUrl);

  await page.waitForSelector('#api-url');
  console.log('5. Options page loaded. Filling API URL and PAT...');
  await page.fill('#api-url', 'http://localhost:4000');
  await page.fill('#pat-token', rawToken);

  console.log('6. Clicking Test Connection...');
  await page.click('#test-connection-btn');

  console.log('7. Waiting for success status banner...');
  await page.waitForSelector('.status-card.success', { timeout: 8000 });
  const bannerText = await page.innerText('.status-card.success');
  console.log('Status banner output:\n', bannerText);

  if (!bannerText.includes('Connection Verified!') || !bannerText.includes('user_playwright_test')) {
    throw new Error('Status banner does not contain expected success verification content');
  }

  console.log('8. Clicking Save Settings...');
  await page.click('#save-btn');
  await page.waitForTimeout(1000);

  console.log(`9. Capturing verification screenshot to ${ARTIFACT_PATH}...`);
  await page.screenshot({ path: ARTIFACT_PATH, fullPage: true });

  await browser.close();
  await closeServer();
  console.log('Verification completed successfully!');
}

run().catch((err) => {
  console.error('Playwright verification failed:', err);
  process.exit(1);
});
