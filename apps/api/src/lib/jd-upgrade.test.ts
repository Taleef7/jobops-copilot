import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourcedJob } from '@/lib/job-sources';
import { upgradeToFullJd, FULL_JD_MIN_CHARS } from './jd-upgrade';

function baseJob(overrides: Partial<SourcedJob> = {}): SourcedJob {
  return {
    source: 'adzuna',
    company: 'Acme Corp',
    title: 'Senior Software Engineer',
    location: 'Remote',
    descriptionText: 'Short description snippet.',
    jobUrl: 'https://jobs.example.com/posting/123',
    ...overrides,
  };
}

test('upgrades short description when page HTML yields full 2000-char description', async () => {
  const fullDescription = 'A'.repeat(2000);
  const html = `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@type": "JobPosting",
            "title": "Extracted Title",
            "hiringOrganization": { "@type": "Organization", "name": "Extracted Company" },
            "description": "${fullDescription}"
          }
        </script>
      </head>
      <body><div>Job details</div></body>
    </html>
  `;

  const original = baseJob({ descriptionText: 'Short snippet' });
  const result = await upgradeToFullJd(original, {
    assertSafe: async (raw) => ({ ok: true, url: new URL(raw) }),
    fetchImpl: async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
  });

  assert.equal(result.upgraded, true);
  assert.equal(result.job.descriptionText, fullDescription);
  assert.equal(result.job.title, 'Senior Software Engineer');
  assert.equal(result.job.company, 'Acme Corp');
  assert.equal(result.job.jobUrl, 'https://jobs.example.com/posting/123');
});

test('does not fetch when description is already >= 600 chars', async () => {
  let fetchCalled = false;
  const longDesc = 'B'.repeat(FULL_JD_MIN_CHARS);
  const original = baseJob({ descriptionText: longDesc });

  const result = await upgradeToFullJd(original, {
    assertSafe: async (raw) => ({ ok: true, url: new URL(raw) }),
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response('<html><body>unused</body></html>');
    },
  });

  assert.equal(fetchCalled, false);
  assert.equal(result.upgraded, false);
  assert.equal(result.job.descriptionText, longDesc);
});

test('does not fetch when jobUrl is missing', async () => {
  let fetchCalled = false;
  const original = baseJob({ jobUrl: undefined, descriptionText: 'Short snippet' });

  const result = await upgradeToFullJd(original, {
    assertSafe: async (raw) => ({ ok: true, url: new URL(raw) }),
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response('<html><body>unused</body></html>');
    },
  });

  assert.equal(fetchCalled, false);
  assert.equal(result.upgraded, false);
  assert.equal(result.job.descriptionText, 'Short snippet');
});

test('returns original job and upgraded: false when fetchJobPage returns blocked (never throws)', async () => {
  const original = baseJob({ descriptionText: 'Short snippet' });

  const result = await upgradeToFullJd(original, {
    assertSafe: async () => ({ ok: false, reason: 'blocked host' }),
    fetchImpl: async () => new Response('<html><body>blocked</body></html>'),
  });

  assert.equal(result.upgraded, false);
  assert.equal(result.job.descriptionText, original.descriptionText);
  assert.equal(result.job, original);
});

test('does not replace description when extracted text is shorter than 1.5x original', async () => {
  // Original is 500 chars (below 600 chars threshold).
  // Extracted text is 650 chars. 650 <= 500 * 1.5 (= 750), so not replaced.
  const originalDesc = 'C'.repeat(500);
  const extractedDesc = 'D'.repeat(650);
  const html = `<html><body><article><p>${extractedDesc}</p></article></body></html>`;

  const original = baseJob({ descriptionText: originalDesc });
  const result = await upgradeToFullJd(original, {
    assertSafe: async (raw) => ({ ok: true, url: new URL(raw) }),
    fetchImpl: async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
  });

  assert.equal(result.upgraded, false);
  assert.equal(result.job.descriptionText, originalDesc);
});

test('rejects bot challenge or captcha pages and preserves original snippet', async () => {
  const challengeBody = 'Please verify you are human to continue accessing our site. ' + 'Cloudflare protection '.repeat(50);
  const html = `<html><body><div>${challengeBody}</div></body></html>`;

  const original = baseJob({ descriptionText: 'Short snippet' });
  const result = await upgradeToFullJd(original, {
    assertSafe: async (raw) => ({ ok: true, url: new URL(raw) }),
    fetchImpl: async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
  });

  assert.equal(result.upgraded, false);
  assert.equal(result.job.descriptionText, 'Short snippet');
});

test('rejects generic non-job heuristic pages without job content evidence', async () => {
  const genericBody = 'Welcome to our generic marketing homepage. Learn more about our products. '.repeat(20);
  const html = `<html><body><main>${genericBody}</main></body></html>`;

  const original = baseJob({ descriptionText: 'Short snippet' });
  const result = await upgradeToFullJd(original, {
    assertSafe: async (raw) => ({ ok: true, url: new URL(raw) }),
    fetchImpl: async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
  });

  assert.equal(result.upgraded, false);
  assert.equal(result.job.descriptionText, 'Short snippet');
});

test('accepts heuristic pages containing job structure keywords', async () => {
  const jobBody = 'Key responsibilities include building scalable services. Qualifications required: 5 years experience. '.repeat(10);
  const html = `<html><body><main><p>${jobBody}</p></main></body></html>`;

  const original = baseJob({ descriptionText: 'Short snippet' });
  const result = await upgradeToFullJd(original, {
    assertSafe: async (raw) => ({ ok: true, url: new URL(raw) }),
    fetchImpl: async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
  });

  assert.equal(result.upgraded, true);
  assert.ok(result.job.descriptionText.length >= 600);
});

test('respects timeoutMs and fails closed without throwing', async () => {
  const original = baseJob({ descriptionText: 'Short snippet' });
  const result = await upgradeToFullJd(
    original,
    {
      assertSafe: async (raw) => ({ ok: true, url: new URL(raw) }),
      fetchImpl: async () => new Promise((resolve) => setTimeout(() => resolve(new Response('html')), 500)),
    },
    { timeoutMs: 10 },
  );

  assert.equal(result.upgraded, false);
  assert.equal(result.job.descriptionText, 'Short snippet');
});
