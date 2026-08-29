import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { computeContentHash, parseSalaryFromText, parseSeniority } from './job-enrich';

describe('parseSalaryFromText', () => {
  it('parses a $ range with commas', () => {
    assert.deepEqual(parseSalaryFromText('Pay: $120,000 - $150,000 per year'), { min: 120000, max: 150000, currency: 'USD' });
  });
  it('parses k-suffixed ranges', () => {
    assert.deepEqual(parseSalaryFromText('comp is $120k–$150K DOE'), { min: 120000, max: 150000, currency: 'USD' });
  });
  it('annualizes hourly rates', () => {
    assert.deepEqual(parseSalaryFromText('$45/hr contract'), { min: 93600, max: 93600, currency: 'USD' });
  });
  it('handles "up to" as max-only', () => {
    assert.deepEqual(parseSalaryFromText('up to $95,000'), { min: null, max: 95000, currency: 'USD' });
  });
  it('returns null on text with no salary', () => {
    assert.equal(parseSalaryFromText('We value collaboration and 401k matching.'), null);
  });
  it('rejects noise amounts', () => {
    assert.equal(parseSalaryFromText('save $500 today'), null);
  });
  it('ignores years of experience ranges before salary', () => {
    assert.deepEqual(
      parseSalaryFromText('Requires 3 - 5 years of experience. Salary: $120,000 - $150,000 per year.'),
      { min: 120000, max: 150000, currency: 'USD' },
    );
  });
});

describe('parseSeniority', () => {
  it('title wins over body', () => {
    assert.equal(parseSeniority('Senior Platform Engineer', 'great for junior devs to apply'), 'senior');
  });
  it('staff/principal map to lead', () => {
    assert.equal(parseSeniority('Staff Engineer', ''), 'lead');
  });
  it('returns unknown when unevidenced', () => {
    assert.equal(parseSeniority('Software Engineer', 'We build great software'), 'unknown');
  });
});

describe('computeContentHash', () => {
  it('is stable and case-insensitive on company/title', () => {
    const a = computeContentHash({ company: 'Acme', title: 'Dev', descriptionText: 'x' });
    const b = computeContentHash({ company: 'ACME ', title: ' dev', descriptionText: 'x' });
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });
});
