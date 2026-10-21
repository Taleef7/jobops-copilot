import assert from 'node:assert/strict';
import test from 'node:test';
import { extractJobFromHtml } from './job-url-extract';

const JSONLD = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org/","@type":"JobPosting","title":"AI Engineer",
 "description":"<p>Build <b>agents</b> with TypeScript.</p>",
 "hiringOrganization":{"@type":"Organization","name":"Pebble"},
 "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"San Francisco","addressRegion":"CA","addressCountry":"US"}},
 "jobLocationType":"TELECOMMUTE"}
</script></head><body><h1>Ignored</h1></body></html>`;

test('extracts a JSON-LD JobPosting', () => {
  const result = extractJobFromHtml(JSONLD);
  assert.equal(result.source, 'jsonld');
  assert.equal(result.title, 'AI Engineer');
  assert.equal(result.company, 'Pebble');
  assert.equal(result.location, 'San Francisco, CA, US');
  assert.equal(result.workplaceType, 'remote');
  assert.match(result.descriptionText ?? '', /Build agents with TypeScript/);
});

test('falls back to OpenGraph / meta tags', () => {
  const html = `<html><head>
    <meta property="og:title" content="Backend Engineer">
    <meta property="og:site_name" content="Acme">
    <meta property="og:description" content="Go and Postgres.">
    <title>Backend Engineer — Acme</title></head><body></body></html>`;
  const result = extractJobFromHtml(html);
  assert.equal(result.source, 'opengraph');
  assert.equal(result.title, 'Backend Engineer');
  assert.equal(result.company, 'Acme');
  assert.equal(result.descriptionText, 'Go and Postgres.');
});

test('uses a heuristic when there is no structured data', () => {
  const html = `<html><head><title>x</title></head><body>
    <script>var a=1;</script><h1>Data Scientist</h1>
    <article>We need pandas and SQL skills for this role.</article></body></html>`;
  const result = extractJobFromHtml(html);
  assert.equal(result.title, 'Data Scientist');
  assert.match(result.descriptionText ?? '', /pandas and SQL/);
  assert.equal(result.source, 'heuristic');
});

test('reads a JobPosting nested in an @graph with an array @type', () => {
  const html = `<html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"Organization","name":"Ignored"},
      {"@type":["JobPosting","Thing"],"title":"Graph Role","hiringOrganization":"StringCo"}
    ]}</script></head><body></body></html>`;
  const result = extractJobFromHtml(html);
  assert.equal(result.source, 'jsonld');
  assert.equal(result.title, 'Graph Role');
  // hiringOrganization given as a bare string maps to company.
  assert.equal(result.company, 'StringCo');
});

test('uses the first jobLocation when it is given as an array', () => {
  const html = `<html><head><script type="application/ld+json">
    {"@type":"JobPosting","title":"Multi","jobLocation":[
      {"@type":"Place","address":{"addressLocality":"Austin","addressRegion":"TX"}},
      {"@type":"Place","address":{"addressLocality":"Denver"}}
    ]}</script></head><body></body></html>`;
  const result = extractJobFromHtml(html);
  assert.equal(result.location, 'Austin, TX');
});

test('falls back to <title> in the heuristic tier when there is no h1', () => {
  const html = `<html><head><title>Lone Title Role</title></head><body>
    <p>Some role description text here.</p></body></html>`;
  const result = extractJobFromHtml(html);
  assert.equal(result.title, 'Lone Title Role');
  assert.equal(result.source, 'heuristic');
});

test('skips malformed JSON-LD without throwing', () => {
  const html = `<html><head>
    <script type="application/ld+json">{ not json }</script>
    <meta property="og:title" content="Still Works"></head><body></body></html>`;
  const result = extractJobFromHtml(html);
  assert.equal(result.title, 'Still Works');
});

test('returns source "none" for an empty page', () => {
  const result = extractJobFromHtml('<html><head></head><body></body></html>');
  assert.equal(result.source, 'none');
  assert.equal(result.title, undefined);
});

// #355: the Add job review shows the salary as posted, read the way the store reads it
// when the job is saved, or "Not stated".
test('reads the salary the posting states', () => {
  const html = `<html><head><script type="application/ld+json">
    {"@type":"JobPosting","title":"Engineer",
     "description":"<p>Build APIs.</p><p>The salary range is £80,000 - £95,000.</p>"}
    </script></head><body></body></html>`;
  const result = extractJobFromHtml(html);
  assert.deepEqual(result.salary, { min: 80000, max: 95000, currency: 'GBP' });
});

// A description without a salary states none (null). With no description there's nothing
// to read, so the salary is unknown and left out, as an API from before #355 leaves it out.
test('a posting that states no salary has null, and a page with no description has none', () => {
  assert.equal(extractJobFromHtml(JSONLD).salary, null);
  assert.equal(extractJobFromHtml('<html><head></head><body></body></html>').salary, undefined);
});

// A meta description is a teaser, not the posting: a salary it leaves out is unknown.
test('a description from the page metadata leaves the salary unknown', () => {
  const html = `<html><head>
    <meta property="og:title" content="Backend Engineer">
    <meta property="og:description" content="Build APIs in Go."></head><body></body></html>`;
  const result = extractJobFromHtml(html);
  assert.equal(result.descriptionText, 'Build APIs in Go.');
  assert.equal(result.salary, undefined);
});

test('the salary is the one the store will save, an hourly rate made yearly', () => {
  const html = `<html><head><script type="application/ld+json">
    {"@type":"JobPosting","title":"Engineer","description":"<p>Pay is $45/hr.</p>"}
    </script></head><body></body></html>`;
  assert.deepEqual(extractJobFromHtml(html).salary, { min: 93600, max: 93600, currency: 'USD' });
});
