import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const extDir = join(projectRoot, 'extensions', 'chrome');

const ARTIFACT_PATH = 'C:/Users/talee/.gemini/antigravity/brain/02b9fdec-dbc1-4f06-9b10-b33e52d1e1c1/ext_popup_verification.png';

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
  const userId = 'user_playwright_popup_test';

  console.log('1. Creating a job in CRM for matching...');
  const createJobRes = await fetch('http://localhost:4000/api/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId,
    },
    body: JSON.stringify({
      company: 'Linear',
      title: 'Principal Product Infrastructure Engineer',
      jobUrl: 'https://jobs.ashbyhq.com/linear/556677',
      source: 'manual',
      descriptionText: 'Building the next generation project management engine with TypeScript and React.',
      status: 'shortlisted',
    }),
  });

  const job = await createJobRes.json();
  console.log(`Job created: ${job.id} - ${job.company}`);

  console.log('2. Creating PAT token...');
  const createTokenRes = await fetch('http://localhost:4000/api/ext-tokens', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId,
    },
    body: JSON.stringify({ label: 'Popup Test Token' }),
  });
  const { rawToken } = await createTokenRes.json();

  console.log('3. Starting static server for extension files...');
  const { serverUrl, close: closeServer } = await startStaticServer();

  console.log('4. Launching Playwright browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 400, height: 500 },
  });
  const page = await context.newPage();

  // Mock chrome API with activeTab URL matching the created job
  await page.addInitScript(({ token, matchUrl }) => {
    window.chrome = window.chrome || {};
    window.chrome.storage = {
      sync: {
        get: (keys, cb) => {
          cb({ apiUrl: 'http://localhost:4000', pat: token });
        },
        set: (_items, cb) => { if (cb) cb(); },
      },
      local: {
        get: (keys, cb) => {
          cb({ apiUrl: 'http://localhost:4000', pat: token });
        },
        set: (_items, cb) => { if (cb) cb(); },
      },
    };
    window.chrome.tabs = {
      query: (queryInfo, cb) => {
        const tabs = [{ id: 1, url: matchUrl, active: true }];
        if (cb) cb(tabs);
        return Promise.resolve(tabs);
      },
      create: () => {},
      sendMessage: () => {},
    };
    window.chrome.runtime = {
      openOptionsPage: () => {},
      lastError: null,
    };
  }, { token: rawToken, matchUrl: 'https://jobs.ashbyhq.com/linear/556677' });

  const popupUrl = `${serverUrl}/popup/popup.html`;
  console.log(`5. Navigating to popup page: ${popupUrl}...`);
  await page.goto(popupUrl);

  console.log('6. Waiting for matched job state...');
  await page.waitForSelector('#matched-state:not(.hidden)', { timeout: 8000 });

  const title = await page.innerText('#job-title');
  const company = await page.innerText('#job-company');
  const status = await page.innerText('#job-status');
  const answersText = await page.innerText('#pack-answers-count');

  console.log(`Popup Matched Job: ${title} @ ${company} [${status}]`);
  console.log(`Pack summary: ${answersText}`);

  if (!company.includes('Linear') || !title.includes('Principal Product')) {
    throw new Error('Popup did not display correct matched job details');
  }

  console.log(`7. Capturing verification screenshot to ${ARTIFACT_PATH}...`);
  await page.screenshot({ path: ARTIFACT_PATH });

  await browser.close();
  await closeServer();
  console.log('Popup verification completed successfully!');
}

run().catch((err) => {
  console.error('Playwright popup verification failed:', err);
  process.exit(1);
});
