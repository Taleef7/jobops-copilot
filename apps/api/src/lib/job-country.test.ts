import assert from 'node:assert/strict';
import test from 'node:test';
import { detectJobCountry } from '@/lib/job-country';

test('detectJobCountry reads an explicit country name or code', () => {
  assert.equal(detectJobCountry('London, United Kingdom'), 'the United Kingdom');
  assert.equal(detectJobCountry('Manchester, UK'), 'the United Kingdom');
  assert.equal(detectJobCountry('Atlanta, US'), 'the United States');
  assert.equal(detectJobCountry('New York, NY, USA'), 'the United States');
  assert.equal(detectJobCountry('Toronto, Ontario, Canada'), 'Canada');
  assert.equal(detectJobCountry('Berlin, Germany'), 'Germany');
  assert.equal(detectJobCountry('Lahore, Pakistan'), 'Pakistan');
});

test('detectJobCountry treats a US state name or trailing state code as the United States', () => {
  assert.equal(detectJobCountry('Austin, TX'), 'the United States');
  assert.equal(detectJobCountry('Seattle, WA'), 'the United States');
  assert.equal(detectJobCountry('Fort Wayne, Indiana'), 'the United States');
  assert.equal(detectJobCountry('Remote - California'), 'the United States');
});

test('detectJobCountry returns null when the location does not say', () => {
  assert.equal(detectJobCountry(null), null);
  assert.equal(detectJobCountry(undefined), null);
  assert.equal(detectJobCountry(''), null);
  assert.equal(detectJobCountry('Remote'), null);
  assert.equal(detectJobCountry('Fort Wayne, Allen County'), null);
  assert.equal(detectJobCountry('Hybrid'), null);
  // A lower-case two-letter word is not a state code.
  assert.equal(detectJobCountry('Remote, in office twice a week'), null);
});
