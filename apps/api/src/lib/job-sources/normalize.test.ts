import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adzunaCountryCurrency,
  canonicalJobUrl,
  dedupKey,
  normalizeAdzuna,
  normalizeRemotive,
  type SourcedJob,
} from './normalize';

test('normalizeAdzuna maps and trims an Adzuna result', () => {
  const job = normalizeAdzuna({
    redirect_url: 'https://adzuna.example/x',
    title: '  AI Engineer ',
    company: { display_name: ' Acme ' },
    location: { display_name: ' Remote ' },
    description: 'Build agents',
    created: '2026-06-01T00:00:00Z',
    contract_time: 'full_time',
    salary_min: 110000,
    salary_max: 140001,
  });

  assert.equal(job.source, 'adzuna');
  assert.equal(job.jobUrl, 'https://adzuna.example/x');
  assert.equal(job.company, 'Acme');
  assert.equal(job.title, 'AI Engineer');
  assert.equal(job.location, 'Remote');
  assert.equal(job.employmentType, 'Full-time');
  assert.equal(job.workplaceType, 'remote');
  assert.equal(job.datePosted, '2026-06-01T00:00:00Z');
  assert.equal(job.descriptionText, 'Build agents');
  assert.equal(job.salaryMin, 110000);
  assert.equal(job.salaryMax, 140001);
  assert.equal(job.salaryCurrency, 'USD');
});

test('normalizeAdzuna falls back to safe defaults for missing fields', () => {
  const job = normalizeAdzuna({});
  assert.equal(job.company, 'Unknown');
  assert.equal(job.title, 'Untitled role');
  assert.equal(job.location, '');
  assert.equal(job.employmentType, 'Full-time');
  assert.equal(job.workplaceType, 'onsite');
  assert.equal(job.jobUrl, undefined);
  assert.equal(job.descriptionText, '');
  assert.equal(job.salaryMin, undefined);
  assert.equal(job.salaryMax, undefined);
  assert.equal(job.salaryCurrency, undefined);
});

test('normalizeAdzuna infers workplaceType (onsite default, hybrid/remote from text)', () => {
  assert.equal(
    normalizeAdzuna({ title: 'Backend Engineer', location: { display_name: 'Austin, TX' } }).workplaceType,
    'onsite',
  );
  assert.equal(
    normalizeAdzuna({ title: 'Engineer (Hybrid)', location: { display_name: 'NYC' } }).workplaceType,
    'hybrid',
  );
  assert.equal(
    normalizeAdzuna({ title: 'Remote Engineer', location: { display_name: 'Anywhere' } }).workplaceType,
    'remote',
  );
});

test('normalizeRemotive maps a result and marks it remote', () => {
  const job = normalizeRemotive({
    url: 'https://remotive.example/y',
    title: 'Backend Engineer',
    company_name: 'Globex',
    candidate_required_location: 'Worldwide',
    description: '<p>Do things</p>',
    publication_date: '2026-06-02T00:00:00',
    job_type: 'part_time',
  });

  assert.equal(job.source, 'remotive');
  assert.equal(job.jobUrl, 'https://remotive.example/y');
  assert.equal(job.company, 'Globex');
  assert.equal(job.workplaceType, 'remote');
  assert.equal(job.location, 'Worldwide');
  assert.equal(job.employmentType, 'Part-time');
});

test('normalizeRemotive defaults location to Remote when absent', () => {
  const job = normalizeRemotive({ title: 'X', company_name: 'Y' });
  assert.equal(job.location, 'Remote');
  assert.equal(job.workplaceType, 'remote');
});

test('dedupKey uses the url when present, else company|title|location', () => {
  const withUrl: SourcedJob = {
    jobUrl: 'https://X/A',
    company: 'c',
    title: 't',
    location: 'l',
    source: 'adzuna',
    descriptionText: '',
  };
  const withoutUrl: SourcedJob = {
    company: 'Acme',
    title: 'AI Eng',
    location: 'NYC',
    source: 'adzuna',
    descriptionText: '',
  };
  assert.equal(dedupKey(withUrl), 'x/A');
  assert.equal(dedupKey(withoutUrl), 'acme|ai eng|nyc');
});

test('adzunaCountryCurrency maps known country codes correctly', () => {
  assert.equal(adzunaCountryCurrency('us'), 'USD');
  assert.equal(adzunaCountryCurrency('gb'), 'GBP');
  assert.equal(adzunaCountryCurrency('ca'), 'CAD');
  assert.equal(adzunaCountryCurrency('au'), 'AUD');
  assert.equal(adzunaCountryCurrency('de'), 'EUR');
  assert.equal(adzunaCountryCurrency('xx'), 'USD'); // unknown falls back to USD
});

test('normalizeAdzuna respects the supplied currency parameter', () => {
  const job = normalizeAdzuna({ salary_min: 50000, salary_max: 70000 }, 'GBP');
  assert.equal(job.salaryCurrency, 'GBP');
  assert.equal(job.salaryMin, 50000);
  assert.equal(job.salaryMax, 70000);
});

// #346: the same posting reached through different URLs must give one key.
test('canonicalJobUrl gives one key for an Adzuna ad, whatever the tracking parameters or URL shape', () => {
  const keys = [
    'https://www.adzuna.com/land/ad/5012345678?se=abc&utm_medium=api&utm_source=1b2c&v=A1B2',
    'https://www.adzuna.com/land/ad/5012345678?se=xyz&utm_medium=api&utm_source=9f8e&v=C3D4',
    'https://www.adzuna.com/details/5012345678?utm_medium=api&utm_source=1b2c',
  ].map(canonicalJobUrl);
  assert.deepEqual(new Set(keys), new Set(['adzuna:5012345678']));
  assert.notEqual(canonicalJobUrl('https://www.adzuna.com/land/ad/5012345679?se=abc'), 'adzuna:5012345678');
});

test('canonicalJobUrl keys Greenhouse by job id, on a board or a custom domain', () => {
  const keys = [
    'https://stripe.com/jobs/search?gh_jid=8172503',
    'https://job-boards.greenhouse.io/stripe/jobs/8172503',
    'https://boards.greenhouse.io/stripe/jobs/8172503?gh_src=abc123',
    'https://boards.greenhouse.io/embed/job_app?for=stripe&token=8172503',
  ].map(canonicalJobUrl);
  assert.deepEqual(new Set(keys), new Set(['greenhouse:8172503']));
});

test('canonicalJobUrl keys Lever and Ashby by posting id, ignoring the apply page and case', () => {
  const lever = [
    'https://jobs.lever.co/palantir/10dfc8bc-99ad-4ca2-ab76-853cb90a92c2',
    'https://jobs.lever.co/Palantir/10DFC8BC-99AD-4CA2-AB76-853CB90A92C2/apply?lever-source=LinkedIn',
  ].map(canonicalJobUrl);
  assert.deepEqual(new Set(lever), new Set(['lever:10dfc8bc-99ad-4ca2-ab76-853cb90a92c2']));

  const ashby = [
    'https://jobs.ashbyhq.com/openai/2a9f5a4e-1c3b-4d5e-8f70-123456789abc?utm_source=Simplify',
    'https://jobs.ashbyhq.com/openai/2a9f5a4e-1c3b-4d5e-8f70-123456789abc/application',
  ].map(canonicalJobUrl);
  assert.deepEqual(new Set(ashby), new Set(['ashby:2a9f5a4e-1c3b-4d5e-8f70-123456789abc']));
});

test('canonicalJobUrl strips tracking from other URLs but keeps the parameters that name the job', () => {
  assert.equal(
    canonicalJobUrl('https://www.themuse.com/jobs/acme/software-engineer/?utm_source=x&ref=y&source=z#apply'),
    'themuse.com/jobs/acme/software-engineer',
  );
  assert.equal(
    canonicalJobUrl('http://Example.com/careers/job?b=1&id=2'),
    canonicalJobUrl('https://www.example.com/careers/job?id=2&b=1&utm_campaign=spring'),
  );
  assert.notEqual(canonicalJobUrl('https://example.com/job?id=2'), canonicalJobUrl('https://example.com/job?id=3'));
  // Not a URL: still a stable key.
  assert.equal(canonicalJobUrl('  Not A URL '), 'not a url');
});

test('canonicalJobUrl keeps the case of a path and of parameter values, which can name different postings', () => {
  assert.notEqual(canonicalJobUrl('https://careers.example.com/jobs/AbC'), canonicalJobUrl('https://careers.example.com/jobs/abc'));
  assert.notEqual(canonicalJobUrl('https://example.com/job?id=AbC'), canonicalJobUrl('https://example.com/job?id=abc'));
  // The host and the tracking parameter names are still case-insensitive.
  assert.equal(canonicalJobUrl('https://Careers.Example.com/jobs/AbC?UTM_Source=x'), 'careers.example.com/jobs/AbC');
});
