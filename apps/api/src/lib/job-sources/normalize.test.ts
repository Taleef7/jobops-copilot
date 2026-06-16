import assert from 'node:assert/strict';
import test from 'node:test';
import { dedupKey, normalizeAdzuna, normalizeRemotive, type SourcedJob } from './normalize';

test('normalizeAdzuna maps and trims an Adzuna result', () => {
  const job = normalizeAdzuna({
    redirect_url: 'https://adzuna.example/x',
    title: '  AI Engineer ',
    company: { display_name: ' Acme ' },
    location: { display_name: ' Remote ' },
    description: 'Build agents',
    created: '2026-06-01T00:00:00Z',
    contract_time: 'full_time',
  });

  assert.equal(job.source, 'adzuna');
  assert.equal(job.jobUrl, 'https://adzuna.example/x');
  assert.equal(job.company, 'Acme');
  assert.equal(job.title, 'AI Engineer');
  assert.equal(job.location, 'Remote');
  assert.equal(job.employmentType, 'Full-time');
  assert.equal(job.datePosted, '2026-06-01T00:00:00Z');
  assert.equal(job.descriptionText, 'Build agents');
});

test('normalizeAdzuna falls back to safe defaults for missing fields', () => {
  const job = normalizeAdzuna({});
  assert.equal(job.company, 'Unknown');
  assert.equal(job.title, 'Untitled role');
  assert.equal(job.location, '');
  assert.equal(job.employmentType, 'Full-time');
  assert.equal(job.jobUrl, undefined);
  assert.equal(job.descriptionText, '');
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
  assert.equal(dedupKey(withUrl), 'https://x/a');
  assert.equal(dedupKey(withoutUrl), 'acme|ai eng|nyc');
});
