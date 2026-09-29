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

test('a two-letter code that is also a country code is ambiguous, unless it is in a US address', () => {
  // CA is California or Canada, DE is Delaware or Germany, IN is Indiana or India.
  assert.equal(detectJobCountry('Toronto, CA'), null);
  assert.equal(detectJobCountry('Berlin, DE'), null);
  assert.equal(detectJobCountry('Remote - IN'), null);
  assert.equal(detectJobCountry('San Francisco, CA'), null);
  // A five-digit postal code doesn't settle it: German ones have five digits too.
  assert.equal(detectJobCountry('Berlin, DE 10115'), null);
  assert.equal(detectJobCountry('San Francisco, CA 94105'), null);
  // In a US address the code is the state.
  assert.equal(detectJobCountry('San Francisco, CA 94105, USA'), 'the United States');
  assert.equal(detectJobCountry('Wilmington, DE 19801-1234, United States'), 'the United States');
  assert.equal(detectJobCountry('Atlanta, GA, US'), 'the United States');
  assert.equal(detectJobCountry('Chicago, IL 60601 USA'), 'the United States');
  assert.equal(detectJobCountry('Berlin, DE 10115, Germany'), null);
  // Codes that are only US states stay unambiguous, with or without a ZIP code.
  assert.equal(detectJobCountry('Austin, TX'), 'the United States');
  assert.equal(detectJobCountry('Austin, TX 78701'), 'the United States');
  assert.equal(detectJobCountry('Brooklyn, NY'), 'the United States');
});

test('an ambiguous code listed beside a country is not assumed to be its state', () => {
  assert.equal(detectJobCountry('Remote - US/CA'), null);
  assert.equal(detectJobCountry('US/DE'), null);
  assert.equal(detectJobCountry('Remote - US/IN'), null);
  assert.equal(detectJobCountry('Remote - CA/US'), null);
  assert.equal(detectJobCountry('US, CA'), null);
  assert.equal(detectJobCountry('Remote (US, CA)'), null);
  assert.equal(detectJobCountry('US & CA'), null);
  assert.equal(detectJobCountry('Remote in US or CA'), null);
  assert.equal(detectJobCountry('New York, NY or Toronto, CA'), null);
  assert.equal(detectJobCountry('CA / San Francisco, CA, USA'), null);
  assert.equal(detectJobCountry('US-CA-San Francisco'), null);
  // Codes that are only US states are still the United States when listed.
  assert.equal(detectJobCountry('Remote - TX/NY'), 'the United States');
  // A region code in brackets, the Italian way, is not read as a US state.
  assert.equal(detectJobCountry('Milano (MI)'), null);
});

test('state names that are also country names are read carefully', () => {
  assert.equal(detectJobCountry('Albuquerque, New Mexico'), 'the United States');
  assert.equal(detectJobCountry('Mexico City, Mexico'), 'Mexico');
  // Georgia is a US state and a country.
  assert.equal(detectJobCountry('Atlanta, Georgia'), null);
  assert.equal(detectJobCountry('Tbilisi, Georgia'), null);
  assert.equal(detectJobCountry('Atlanta, Georgia, USA'), 'the United States');
});

test('conflicting signals mean the country is unknown, in either direction', () => {
  // A US state name next to another country.
  assert.equal(detectJobCountry('Indiana, India'), null);
  assert.equal(detectJobCountry('Washington, England, United Kingdom'), null);
  // US towns named after countries.
  assert.equal(detectJobCountry('Poland, Ohio'), null);
  assert.equal(detectJobCountry('Mexico, Missouri'), null);
  // Two countries.
  assert.equal(detectJobCountry('Remote - United States or Canada'), null);
  // The same country named twice is not a conflict.
  assert.equal(detectJobCountry('Seattle, Washington, USA'), 'the United States');
  assert.equal(detectJobCountry('Manchester, England, United Kingdom'), 'the United Kingdom');
});

test('every country is recognized, not just a short list', () => {
  // Countries outside any hand-made list still count, so they still conflict.
  assert.equal(detectJobCountry('United States or China'), null);
  assert.equal(detectJobCountry('California, China'), null);
  assert.equal(detectJobCountry('Shanghai, China'), 'China');
  assert.equal(detectJobCountry('Lagos, Nigeria'), 'Nigeria');
  assert.equal(detectJobCountry('Nairobi, Kenya'), 'Kenya');
  assert.equal(detectJobCountry('São Paulo, Brazil'), 'Brazil');
  assert.equal(detectJobCountry('Amsterdam, Netherlands'), 'the Netherlands');
  assert.equal(detectJobCountry('Port Moresby, Papua New Guinea'), 'Papua New Guinea');
  // Longer names win, so parts of them don't count as other places.
  assert.equal(detectJobCountry('Jersey City, New Jersey'), 'the United States');
  assert.equal(detectJobCountry('Hoboken, NJ'), 'the United States');
});

test('an ambiguous state code still counts against a foreign city name', () => {
  // US towns named after countries, with a state code that is also a country code.
  assert.equal(detectJobCountry('Lebanon, TN'), null);
  assert.equal(detectJobCountry('Mexico, MO'), null);
  assert.equal(detectJobCountry('Berlin, DE, Germany'), null);
  // With nothing else named, the code alone still decides nothing.
  assert.equal(detectJobCountry('Nashville, TN'), null);
  assert.equal(detectJobCountry('Nashville, TN 37203'), null);
  assert.equal(detectJobCountry('Nashville, TN 37203, USA'), 'the United States');
});

test('a capitalised US or UK anywhere names the country; lower-case "us" does not', () => {
  assert.equal(detectJobCountry('Remote (US only)'), 'the United States');
  assert.equal(detectJobCountry('Remote (UK)'), 'the United Kingdom');
  assert.equal(detectJobCountry('Remote, join us anywhere'), null);
  assert.equal(detectJobCountry('Remote (US or Canada)'), null);
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
  // Words that are also object keys are not codes.
  assert.equal(detectJobCountry('Remote, toString'), null);
});
