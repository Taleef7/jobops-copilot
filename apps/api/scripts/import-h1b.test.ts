import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHeaders, aggregateH1bRows } from './import-h1b';

test('resolveHeaders maps standard USCIS headers case-insensitively', () => {
  const headers = [
    'Fiscal Year',
    'Employer (Petitioner) Name',
    'Petitioner State',
    'Initial Approval',
    'Initial Denial',
    'Continuing Approval',
    'Continuing Denial',
  ];

  const resolved = resolveHeaders(headers);
  assert.equal(resolved.fiscalYear, 'Fiscal Year');
  assert.equal(resolved.employer, 'Employer (Petitioner) Name');
  assert.equal(resolved.initialApproval, 'Initial Approval');
  assert.equal(resolved.initialDenial, 'Initial Denial');
  assert.equal(resolved.continuingApproval, 'Continuing Approval');
  assert.equal(resolved.continuingDenial, 'Continuing Denial');
});

test('resolveHeaders throws error naming the column when employer column is missing', () => {
  const headers = [
    'Fiscal Year',
    'Petitioner State',
    'Initial Approval',
    'Initial Denial',
  ];

  assert.throws(
    () => resolveHeaders(headers),
    (err: Error) => {
      return /employer/i.test(err.message);
    },
  );
});

test('aggregateH1bRows aggregates 4 rows (same employer, two states, two years, comma counts) to 2 upsert rows with summed counts', () => {
  const fixture: Record<string, string>[] = [
    {
      'Fiscal Year': '2024',
      'Employer (Petitioner) Name': 'Google, LLC',
      'Petitioner State': 'CA',
      'Initial Approval': '1,000',
      'Continuing Approval': '2,000',
      'Initial Denial': '10',
      'Continuing Denial': '5',
    },
    {
      'Fiscal Year': '2024',
      'Employer (Petitioner) Name': 'Google Inc',
      'Petitioner State': 'NY',
      'Initial Approval': '500',
      'Continuing Approval': '300',
      'Initial Denial': '2',
      'Continuing Denial': '1',
    },
    {
      'Fiscal Year': '2023',
      'Employer (Petitioner) Name': 'Google LLC',
      'Petitioner State': 'CA',
      'Initial Approval': '800',
      'Continuing Approval': '1,200',
      'Initial Denial': '20',
      'Continuing Denial': '10',
    },
    {
      'Fiscal Year': '2023',
      'Employer (Petitioner) Name': 'Google',
      'Petitioner State': 'WA',
      'Initial Approval': '400',
      'Continuing Approval': '100',
      'Initial Denial': '5',
      'Continuing Denial': '2',
    },
  ];

  const aggregated = aggregateH1bRows(fixture);
  assert.equal(aggregated.length, 2);

  const row2024 = aggregated.find((r) => r.fiscalYear === 2024);
  const row2023 = aggregated.find((r) => r.fiscalYear === 2023);

  assert.ok(row2024, '2024 row should exist');
  assert.ok(row2023, '2023 row should exist');

  assert.equal(row2024.employerNameNormalized, 'google');
  // 2024: (1000 + 2000) + (500 + 300) = 3800 approvals
  assert.equal(row2024.approvals, 3800);
  // 2024: (10 + 5) + (2 + 1) = 18 denials
  assert.equal(row2024.denials, 18);

  assert.equal(row2023.employerNameNormalized, 'google');
  // 2023: (800 + 1200) + (400 + 100) = 2500 approvals
  assert.equal(row2023.approvals, 2500);
  // 2023: (20 + 10) + (5 + 2) = 37 denials
  assert.equal(row2023.denials, 37);
});
