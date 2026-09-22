import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const extDir = join(projectRoot, 'extensions', 'chrome');

const ARTIFACT_PATH = 'C:/Users/talee/.gemini/antigravity/brain/02b9fdec-dbc1-4f06-9b10-b33e52d1e1c1/ext_autofill_greenhouse_verification.png';

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
      let filePath;
      if (urlPath.startsWith('/fixtures/')) {
        filePath = join(extDir, 'test', urlPath);
      } else {
        filePath = join(extDir, urlPath.replace(/^\//, ''));
      }
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
  console.log('1. Starting static server for extension files and test fixtures...');
  const { serverUrl, close: closeServer } = await startStaticServer();

  console.log('2. Launching Playwright browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1100, height: 950 },
  });
  const page = await context.newPage();

  page.on('console', (msg) => console.log('[PAGE CONSOLE]', msg.text()));
  page.on('pageerror', (err) => console.log('[PAGE ERROR]', err));

  // Mock chrome extension runtime API in page context
  await page.addInitScript(() => {
    const mockProfileData = {
      profile: {
        fullName: 'Jane Doe',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@example.com',
        phone: '+1 (555) 234-5678',
        location: 'New York, NY',
        city: 'New York',
        state: 'NY',
        country: 'United States',
        postalCode: '10001',
        linkedinUrl: 'https://linkedin.com/in/janedoe',
        githubUrl: 'https://github.com/janedoe',
        portfolioUrl: 'https://janedoe.me',
        websiteUrl: 'https://janedoe.me',
        summary: 'Experienced Staff Full Stack Engineer with 8+ years building distributed applications.',
        currentTitle: 'Staff Software Engineer',
        currentCompany: 'Apex Systems',
        workAuthorization: {
          authorizedInUS: true,
          requireSponsorship: false,
        },
      },
      workExperience: [],
      education: [],
      skills: ['TypeScript', 'React', 'Node.js'],
      answers: {
        'what is your expected salary?': '$185,000 USD base',
        'are you legally authorized to work in the united states?': 'Yes',
        'will you now or in the future require visa sponsorship?': 'No',
      },
    };

    const mockMatchedJob = {
      id: 'job_gh_001',
      company: 'Acme Corp',
      title: 'Senior Full Stack Engineer',
      status: 'shortlisted',
    };

    const mockPack = {
      jobId: 'job_gh_001',
      company: 'Acme Corp',
      title: 'Senior Full Stack Engineer',
      resumeVersionId: 'res_001',
      coverLetterText: 'Dear Hiring Team at Acme Corp, I am excited to submit my application for the Senior Full Stack Engineer role...',
      answers: [
        {
          questionText: 'Are you legally authorized to work in the United States?',
          questionHash: 'h1',
          answer: 'Yes',
          category: 'work_authorization',
          source: 'profile',
          flagged: false,
        },
        {
          questionText: 'Will you now or in the future require visa sponsorship?',
          questionHash: 'h2',
          answer: 'No',
          category: 'work_authorization',
          source: 'profile',
          flagged: false,
        },
        {
          questionText: 'What is your expected salary?',
          questionHash: 'h3',
          answer: '$185,000 USD base',
          category: 'salary',
          source: 'qa_memory',
          flagged: false,
        },
      ],
      flaggedQuestions: [],
    };

    window.chrome = window.chrome || {};
    window.chrome.runtime = {
      sendMessage: (message, cb) => {
        let res = { ok: true, data: null };
        if (message.type === 'MATCH_URL') {
          res = { ok: true, data: { matched: true, job: mockMatchedJob, applicationPack: mockPack } };
        } else if (message.type === 'GET_PROFILE_FILL') {
          res = { ok: true, data: mockProfileData };
        } else if (message.type === 'CAPTURE_SUBMISSION') {
          res = { ok: true, data: { success: true } };
        }
        if (cb) setTimeout(() => cb(res), 0);
        return Promise.resolve(res);
      },
      onMessage: {
        addListener: () => {},
      },
    };
  });

  const fixtureUrl = `${serverUrl}/fixtures/greenhouse.html`;
  console.log(`3. Navigating to Greenhouse fixture: ${fixtureUrl}...`);
  await page.goto(fixtureUrl);

  console.log('4. Injecting extension content stylesheet and script...');
  await page.addStyleTag({ url: `${serverUrl}/dist/content.css` });
  await page.addScriptTag({ url: `${serverUrl}/dist/content.js` });

  console.log('5. Waiting for JobOps overlay banner to mount...');
  await page.waitForSelector('#jobops-overlay-root .jobops-banner', { timeout: 8000 });

  const bannerJob = await page.innerText('.jobops-banner-job');
  const bannerCompany = await page.innerText('.jobops-banner-company');
  console.log(`Overlay matched: ${bannerJob} @ ${bannerCompany}`);

  console.log('6. Clicking Autofill Form button...');
  await page.click('#jobops-overlay-autofill-btn');

  console.log('7. Verifying fields are populated...');
  await page.waitForTimeout(500);

  const firstName = await page.inputValue('#first_name');
  const lastName = await page.inputValue('#last_name');
  const email = await page.inputValue('#email');
  const phone = await page.inputValue('#phone');
  const coverLetter = await page.inputValue('#cover_letter_text');
  const linkedin = await page.inputValue('#custom_linkedin');
  const salary = await page.inputValue('#custom_salary');
  const workAuthVal = await page.inputValue('#custom_work_auth');
  const sponsorshipVal = await page.inputValue('#custom_sponsorship');

  console.log('Filled field values:');
  console.log(`  First Name: ${firstName}`);
  console.log(`  Last Name: ${lastName}`);
  console.log(`  Email: ${email}`);
  console.log(`  Phone: ${phone}`);
  console.log(`  LinkedIn: ${linkedin}`);
  console.log(`  Salary: ${salary}`);
  console.log(`  Work Auth Option: ${workAuthVal}`);
  console.log(`  Sponsorship Option: ${sponsorshipVal}`);
  console.log(`  Cover Letter length: ${coverLetter.length} chars`);

  if (firstName !== 'Jane' || lastName !== 'Doe' || email !== 'jane.doe@example.com') {
    throw new Error('Basic personal info was not populated correctly');
  }

  if (salary !== '$185,000 USD base') {
    throw new Error(`Salary custom question was not populated correctly, got: ${salary}`);
  }

  // Check green highlight border on fields
  const isHighlighted = await page.$eval('#first_name', (el) => el.classList.contains('jobops-field-highlighted'));
  if (!isHighlighted) {
    throw new Error('Fields were not highlighted with jobops-field-highlighted class');
  }

  const pillText = await page.innerText('.jobops-pill-text');
  console.log(`Pill progress: ${pillText}`);

  console.log(`8. Capturing verification screenshot to ${ARTIFACT_PATH}...`);
  await page.screenshot({ path: ARTIFACT_PATH, fullPage: true });

  await browser.close();
  await closeServer();
  console.log('ATS autofill Playwright verification completed successfully!');
}

run().catch((err) => {
  console.error('Playwright ATS autofill verification failed:', err);
  process.exit(1);
});
