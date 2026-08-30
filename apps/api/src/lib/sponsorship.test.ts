import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEmployerName, lookupSponsorLikelihood } from './sponsorship';

test('normalizeEmployerName strips punctuation and one suffix', () => {
  assert.equal(normalizeEmployerName('Google, LLC'), 'google');
});

test('normalizeEmployerName strips stacked suffixes', () => {
  assert.equal(normalizeEmployerName('Acme Holdings LLC'), 'acme');
});

test('normalizeEmployerName maps & to and', () => {
  assert.equal(normalizeEmployerName('Ernst & Young U.S. LLP'), 'ernst and young');
});

test('normalizeEmployerName never empties a name made of suffix words', () => {
  assert.equal(normalizeEmployerName('CO Inc'), 'co');
});

test('normalizeEmployerName collapses whitespace and case', () => {
  assert.equal(normalizeEmployerName('  MICROSOFT   CORPORATION '), 'microsoft');
});

test('lookupSponsorLikelihood returns null when pool is null', async () => {
  const originalUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const result = await lookupSponsorLikelihood('Google');
    assert.equal(result, null);
  } finally {
    if (originalUrl !== undefined) {
      process.env.DATABASE_URL = originalUrl;
    }
  }
});

test('lookupSponsorLikelihood returns null when company is empty', async () => {
  const result = await lookupSponsorLikelihood('');
  assert.equal(result, null);

  const whitespaceResult = await lookupSponsorLikelihood('   ');
  assert.equal(whitespaceResult, null);
});

test('lookupSponsorLikelihood returns known_sponsor when filings exist', async () => {
  const mockPool = {
    query: async () => ({
      rows: [{ approvals: 42, denials: 3 }],
      rowCount: 1,
    }),
  } as unknown as import('pg').Pool;

  const result = await lookupSponsorLikelihood('Google, LLC', mockPool);
  assert.deepEqual(result, {
    status: 'known_sponsor',
    approvals: 42,
    denials: 3,
  });
});

test('lookupSponsorLikelihood returns null when total filings sum to zero', async () => {
  const mockPool = {
    query: async () => ({
      rows: [{ approvals: 0, denials: 0 }],
      rowCount: 1,
    }),
  } as unknown as import('pg').Pool;

  const result = await lookupSponsorLikelihood('Unknown Startup LLC', mockPool);
  assert.equal(result, null);
});
