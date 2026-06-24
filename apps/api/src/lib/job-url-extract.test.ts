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
  assert.ok(result.source === 'heuristic' || result.source === 'opengraph');
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
