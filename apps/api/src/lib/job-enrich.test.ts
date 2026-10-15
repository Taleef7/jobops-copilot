import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { computeContentHash, parseSalaryFromText, parseSeniority, readSalaryForReview } from './job-enrich';

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
  it('ignores bare k-suffixed metric ranges without salary context', () => {
    assert.equal(
      parseSalaryFromText('Our platform serves 10k-20k users daily.'),
      null,
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

// #355: parse-job reads the salary from pasted text, so a hostile paste reaches these
// regexes. Unbounded digit runs made them quadratic: 40k digits stalled the API for 21 s.
describe('parseSalaryFromText on hostile input', () => {
  const inputs: Array<[string, string]> = [
    ['a long run of digits', '1'.repeat(40_000)],
    ['a long run of digits after a currency sign', `$${'9'.repeat(40_000)}`],
    ['a long comma-grouped number', `$1${',000'.repeat(10_000)}`],
    ['a long decimal tail', `$1.${'5'.repeat(40_000)}`],
    ['a long run of spaces between digits', `1${' '.repeat(40_000)}1`],
    ['digits separated by spaces', '1 '.repeat(20_000)],
    ['ranges without an end', '1-'.repeat(20_000)],
  ];
  for (const [name, text] of inputs) {
    it(`finishes in under 100 ms on ${name}`, () => {
      const started = performance.now();
      parseSalaryFromText(text);
      const elapsed = performance.now() - started;
      assert.ok(elapsed < 100, `${elapsed.toFixed(0)} ms`);
    });
  }
  it('still reads a salary after a long id', () => {
    assert.deepEqual(parseSalaryFromText(`Req ${'7'.repeat(30)}. Salary: $120,000 - $150,000`), {
      min: 120000,
      max: 150000,
      currency: 'USD',
    });
  });
});

// #355: the Add job review shows a salary only as the posting states it. A figure the parser
// converted (an hourly rate made annual) or whose currency it can't be sure of is unknown,
// and so is a salary it couldn't read. Only a posting with no sign of a salary is "not stated".
describe('readSalaryForReview', () => {
  it('reads an annual range in a currency it knows', () => {
    assert.deepEqual(readSalaryForReview('The salary range is £80,000 - £95,000.'), { min: 80000, max: 95000, currency: 'GBP' });
    assert.deepEqual(readSalaryForReview('Pay: $120,000 - $150,000 per year'), { min: 120000, max: 150000, currency: 'USD' });
  });
  it('is unknown for an hourly rate, which the store makes annual', () => {
    assert.equal(readSalaryForReview('Pay is $45/hr on contract.'), undefined);
  });
  it('is unknown for a rate it cannot read', () => {
    assert.equal(readSalaryForReview('We pay $40 - $60 / hour depending on experience.'), undefined);
  });
  it('is unknown when the currency could be another dollar', () => {
    assert.equal(readSalaryForReview('Salary: $120,000 - $150,000 CAD'), undefined);
    assert.equal(readSalaryForReview('Salary: C$120,000 - C$150,000'), undefined);
  });
  it('is unknown when the posting talks about pay without a figure it can read', () => {
    assert.equal(readSalaryForReview('Competitive salary and equity.'), undefined);
  });
  it('is not stated when the posting has no sign of a salary', () => {
    assert.equal(readSalaryForReview('Build payment APIs in Go and Postgres.'), null);
  });
  it('reads a 100k-character posting quickly', () => {
    const started = performance.now();
    readSalaryForReview(`${'Build APIs in Go. '.repeat(5_500)}Salary: $120,000 - $150,000`);
    assert.ok(performance.now() - started < 200);
  });
});
