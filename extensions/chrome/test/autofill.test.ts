import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { ashbyAdapter } from '../src/content/ats/ashby';
import { greenhouseAdapter } from '../src/content/ats/greenhouse';
import { resolveAtsAdapter } from '../src/content/ats/index';
import { leverAdapter } from '../src/content/ats/lever';
import { workdayAdapter } from '../src/content/ats/workday';
import type { ApplicationPackPayload, ProfileFillData } from '../src/types';

const fixturesDir = join(process.cwd(), 'test', 'fixtures');

const mockProfile: ProfileFillData = {
  profile: {
    fullName: 'Alex Rivera',
    firstName: 'Alex',
    lastName: 'Rivera',
    email: 'alex.rivera@example.com',
    phone: '+1 555-0144',
    location: 'San Francisco, CA',
    city: 'San Francisco',
    state: 'CA',
    country: 'United States',
    postalCode: '94107',
    linkedinUrl: 'https://linkedin.com/in/alex-rivera',
    githubUrl: 'https://github.com/alex-rivera',
    portfolioUrl: 'https://alexrivera.dev',
    websiteUrl: 'https://alexrivera.dev',
    summary: 'Senior Infrastructure Engineer specializing in distributed systems.',
    currentTitle: 'Senior Infrastructure Engineer',
    currentCompany: 'CloudScale Inc',
    workAuthorization: {
      authorizedInUS: true,
      requireSponsorship: false,
    },
  },
  workExperience: [
    {
      company: 'CloudScale Inc',
      position: 'Senior Infrastructure Engineer',
      startDate: '2021-03',
      highlights: ['Led zero-downtime database migrations'],
    },
  ],
  education: [
    {
      institution: 'UC Berkeley',
      studyType: 'B.S.',
      area: 'Computer Science',
    },
  ],
  skills: ['TypeScript', 'Go', 'Kubernetes'],
  answers: {
    'what is your expected salary?': '$175,000 USD base',
    'desired base salary': '$175,000 USD base',
    'target compensation': '$175,000 USD base',
  },
};

const mockPack: ApplicationPackPayload = {
  jobId: 'job_test_001',
  company: 'Target Corp',
  title: 'Senior Systems Engineer',
  resumeVersionId: 'res_001',
  resumeFileUrl: 'https://storage.blob.core.windows.net/resumes/res_001.pdf',
  coverLetterId: 'cov_001',
  coverLetterText: 'I am excited to apply for the Senior Systems Engineer position at Target Corp...',
  contactBlock: {
    fullName: 'Alex Rivera',
    email: 'alex.rivera@example.com',
    phone: '+1 555-0144',
    location: 'San Francisco, CA',
  },
  answers: [
    {
      questionText: 'Are you legally authorized to work in the United States?',
      questionHash: 'hash_auth',
      answer: 'Yes',
      category: 'work_authorization',
      source: 'profile',
      flagged: false,
    },
    {
      questionText: 'Will you now or in the future require visa sponsorship?',
      questionHash: 'hash_sponsor',
      answer: 'No',
      category: 'work_authorization',
      source: 'profile',
      flagged: false,
    },
    {
      questionText: 'What are your target compensation / salary expectations?',
      questionHash: 'hash_salary',
      answer: '$175,000 USD base',
      category: 'salary',
      source: 'qa_memory',
      flagged: false,
    },
  ],
  flaggedQuestions: [],
  generatedAt: new Date().toISOString(),
};

test('Greenhouse adapter autofills standard fields, custom questions, and highlights', async () => {
  const html = await readFile(join(fixturesDir, 'greenhouse.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://boards.greenhouse.io/acme/jobs/12345' });
  const doc = dom.window.document;

  assert.equal(greenhouseAdapter.matches('https://boards.greenhouse.io/acme/jobs/12345', doc), true);

  const result = greenhouseAdapter.autofill({
    document: doc,
    url: 'https://boards.greenhouse.io/acme/jobs/12345',
    profileData: mockProfile,
    applicationPack: mockPack,
  });

  assert.equal(result.atsName, 'greenhouse');
  assert.ok(result.filledFields.length >= 6);

  // Check standard inputs
  const firstName = doc.querySelector<HTMLInputElement>('#first_name');
  assert.equal(firstName?.value, 'Alex');
  assert.ok(firstName?.classList.contains('jobops-field-highlighted'));

  const lastName = doc.querySelector<HTMLInputElement>('#last_name');
  assert.equal(lastName?.value, 'Rivera');

  const email = doc.querySelector<HTMLInputElement>('#email');
  assert.equal(email?.value, 'alex.rivera@example.com');

  const phone = doc.querySelector<HTMLInputElement>('#phone');
  assert.equal(phone?.value, '+1 555-0144');

  const coverLetter = doc.querySelector<HTMLTextAreaElement>('#cover_letter_text');
  assert.match(coverLetter?.value || '', /Senior Systems Engineer/);

  // Check custom fields
  const linkedin = doc.querySelector<HTMLInputElement>('#custom_linkedin');
  assert.equal(linkedin?.value, 'https://linkedin.com/in/alex-rivera');

  const salary = doc.querySelector<HTMLInputElement>('#custom_salary');
  assert.equal(salary?.value, '$175,000 USD base');

  const authSelect = doc.querySelector<HTMLSelectElement>('#custom_work_auth');
  assert.equal(authSelect?.selectedOptions[0]?.text, 'Yes');

  const sponsorSelect = doc.querySelector<HTMLSelectElement>('#custom_sponsorship');
  assert.equal(sponsorSelect?.selectedOptions[0]?.text, 'No');

  // Test submission detection
  const sub = greenhouseAdapter.detectSubmission('https://boards.greenhouse.io/acme/jobs/12345/confirmation', doc);
  assert.ok(sub);
  assert.equal(sub?.atsName, 'greenhouse');
});

test('Lever adapter autofills contact info, socials, and questions', async () => {
  const html = await readFile(join(fixturesDir, 'lever.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://jobs.lever.co/techcorp/98765' });
  const doc = dom.window.document;

  assert.equal(leverAdapter.matches('https://jobs.lever.co/techcorp/98765', doc), true);

  const result = leverAdapter.autofill({
    document: doc,
    url: 'https://jobs.lever.co/techcorp/98765',
    profileData: mockProfile,
    applicationPack: mockPack,
  });

  assert.equal(result.atsName, 'lever');
  assert.ok(result.filledFields.length >= 6);

  assert.equal(doc.querySelector<HTMLInputElement>('input[name="name"]')?.value, 'Alex Rivera');
  assert.equal(doc.querySelector<HTMLInputElement>('input[name="email"]')?.value, 'alex.rivera@example.com');
  assert.equal(doc.querySelector<HTMLInputElement>('input[name="phone"]')?.value, '+1 555-0144');
  assert.equal(doc.querySelector<HTMLInputElement>('input[name="org"]')?.value, 'CloudScale Inc');
  assert.equal(doc.querySelector<HTMLInputElement>('input[name="urls[LinkedIn]"]')?.value, 'https://linkedin.com/in/alex-rivera');
  assert.equal(doc.querySelector<HTMLInputElement>('input[name="urls[GitHub]"]')?.value, 'https://github.com/alex-rivera');
  assert.equal(doc.querySelector<HTMLInputElement>('input[name="cards[salary]"]')?.value, '$175,000 USD base');

  // Test submission detection
  const sub = leverAdapter.detectSubmission('https://jobs.lever.co/techcorp/98765/thanks', doc);
  assert.ok(sub);
  assert.equal(sub?.atsName, 'lever');
});

test('Ashby adapter autofills personal details, URLs, and questionnaires', async () => {
  const html = await readFile(join(fixturesDir, 'ashby.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://jobs.ashbyhq.com/linear/556677' });
  const doc = dom.window.document;

  assert.equal(ashbyAdapter.matches('https://jobs.ashbyhq.com/linear/556677', doc), true);

  const result = ashbyAdapter.autofill({
    document: doc,
    url: 'https://jobs.ashbyhq.com/linear/556677',
    profileData: mockProfile,
    applicationPack: mockPack,
  });

  assert.equal(result.atsName, 'ashby');
  assert.ok(result.filledFields.length >= 6);

  assert.equal(doc.querySelector<HTMLInputElement>('#ashby-name')?.value, 'Alex Rivera');
  assert.equal(doc.querySelector<HTMLInputElement>('#ashby-email')?.value, 'alex.rivera@example.com');
  assert.equal(doc.querySelector<HTMLInputElement>('#ashby-phone')?.value, '+1 555-0144');
  assert.equal(doc.querySelector<HTMLInputElement>('#ashby-linkedin')?.value, 'https://linkedin.com/in/alex-rivera');
  assert.equal(doc.querySelector<HTMLInputElement>('#ashby-salary')?.value, '$175,000 USD base');

  const sub = ashbyAdapter.detectSubmission('https://jobs.ashbyhq.com/linear/556677/application-success', doc);
  assert.ok(sub);
  assert.equal(sub?.atsName, 'ashby');
});

test('Workday adapter autofills legalName, address, contact, and data-automation fields', async () => {
  const html = await readFile(join(fixturesDir, 'workday.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://salesforce.myworkdayjobs.com/en-US/careers/job/123' });
  const doc = dom.window.document;

  assert.equal(workdayAdapter.matches('https://salesforce.myworkdayjobs.com/en-US/careers/job/123', doc), true);

  const result = workdayAdapter.autofill({
    document: doc,
    url: 'https://salesforce.myworkdayjobs.com/en-US/careers/job/123',
    profileData: mockProfile,
    applicationPack: mockPack,
  });

  assert.equal(result.atsName, 'workday');
  assert.ok(result.filledFields.length >= 6);

  assert.equal(doc.querySelector<HTMLInputElement>('[data-automation-id="legalNameSection_firstName"]')?.value, 'Alex');
  assert.equal(doc.querySelector<HTMLInputElement>('[data-automation-id="legalNameSection_lastName"]')?.value, 'Rivera');
  assert.equal(doc.querySelector<HTMLInputElement>('[data-automation-id="email"]')?.value, 'alex.rivera@example.com');
  assert.equal(doc.querySelector<HTMLInputElement>('[data-automation-id="phone-number"]')?.value, '+1 555-0144');
  assert.equal(doc.querySelector<HTMLInputElement>('[data-automation-id="addressSection_city"]')?.value, 'San Francisco');
  assert.equal(doc.querySelector<HTMLInputElement>('[data-automation-id="addressSection_postalCode"]')?.value, '94107');
  assert.equal(doc.querySelector<HTMLInputElement>('[data-automation-id="addressSection_countryRegion"]')?.value, 'CA');
  assert.equal(doc.querySelector<HTMLInputElement>('[data-automation-id="question-salary"]')?.value, '$175,000 USD base');
});

test('Unknown page returns null adapter (invariant §12: do nothing on unknown pages)', () => {
  const dom = new JSDOM('<html><body><h1>Welcome to Random Blog</h1></body></html>', {
    url: 'https://random-blog.example.com/post/1',
  });
  const adapter = resolveAtsAdapter('https://random-blog.example.com/post/1', dom.window.document);
  assert.equal(adapter, null);
});
