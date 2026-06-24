# Job-URL Autofill — PR A (extract endpoint) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A server-side `POST /api/jobs/extract` that fetches a pasted job URL (behind an SSRF guard) and returns title/company/location/description/workplace extracted from JSON-LD, OpenGraph, or page text.

**Architecture:** Four focused units — a pure HTML extractor (`job-url-extract.ts`), an SSRF guard (`url-safety.ts`), a guarded fetch + composition (`job-url-fetch.ts`), and a thin injectable router (`routes/job-extract.ts`) mounted at `/api/jobs`. Pure pieces are unit-tested against fixtures; I/O is isolated and injected in tests so nothing hits the network.

**Tech Stack:** Express, Node 20 global `fetch`, `node-html-parser` (new dep), `node:dns/promises`, `node:net`; node:test + tsx. Spec: `docs/superpowers/specs/2026-06-24-job-url-autofill-design.md`.

**Branch:** `feat/job-url-extract` (already created; carries the spec). **Scope:** PR A of 2 (B = frontend autofill UX).

---

## File structure

- **Create** `apps/api/src/lib/job-url-extract.ts` — pure: `extractJobFromHtml(html) → ExtractedJob` (JSON-LD → OG → heuristic). + types.
- **Create** `apps/api/src/lib/url-safety.ts` — pure-ish SSRF guard: `isBlockedAddress(ip)`, `assertUrlSafe(url, lookup)`.
- **Create** `apps/api/src/lib/job-url-fetch.ts` — I/O: `fetchJobPage(url, deps)` + `extractJobFromUrl(url, deps)` composition.
- **Create** `apps/api/src/routes/job-extract.ts` — `createJobExtractRouter(deps)` + default `jobExtractRouter`.
- **Modify** `apps/api/src/app.ts` — mount `jobExtractRouter` at `/api/jobs`.
- Test files mirror each lib/route.

---

## Task 1: Pure HTML extractor + `node-html-parser`

**Files:**
- Create: `apps/api/src/lib/job-url-extract.ts`
- Test: `apps/api/src/lib/job-url-extract.test.ts`

- [ ] **Step 1: Add the dependency**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && npm install node-html-parser@^7`
Expected: adds `node-html-parser` to `apps/api/package.json` dependencies.

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/lib/job-url-extract.test.ts`:

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && node --import tsx --test --test-concurrency=1 src/lib/job-url-extract.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `apps/api/src/lib/job-url-extract.ts`:

```ts
import { parse, type HTMLElement } from 'node-html-parser';

export type WorkplaceType = 'remote' | 'hybrid' | 'onsite' | 'flexible';

export interface ExtractedJob {
  title?: string;
  company?: string;
  location?: string;
  descriptionText?: string;
  workplaceType?: WorkplaceType;
  source: 'jsonld' | 'opengraph' | 'heuristic' | 'none';
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** JSON-LD descriptions are usually HTML; flatten to readable text. */
function htmlToText(html: string): string | undefined {
  const text = parse(html).structuredText.trim();
  return text.length > 0 ? text : undefined;
}

// ---- JSON-LD tier ----
function collectJsonLd(root: HTMLElement): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const node of root.querySelectorAll('script[type="application/ld+json"]')) {
    let data: unknown;
    try {
      data = JSON.parse(node.text);
    } catch {
      continue; // malformed block — skip it
    }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (item && typeof item === 'object') {
        out.push(item as Record<string, unknown>);
        const graph = (item as { '@graph'?: unknown })['@graph'];
        if (Array.isArray(graph)) {
          for (const g of graph) if (g && typeof g === 'object') out.push(g as Record<string, unknown>);
        }
      }
    }
  }
  return out;
}

function hasJobPostingType(obj: Record<string, unknown>): boolean {
  const t = obj['@type'];
  return t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'));
}

function companyFrom(org: unknown): string | undefined {
  if (typeof org === 'string') return clean(org);
  if (org && typeof org === 'object') return clean((org as { name?: unknown }).name);
  return undefined;
}

function locationFrom(loc: unknown): string | undefined {
  const first = Array.isArray(loc) ? loc[0] : loc;
  if (!first || typeof first !== 'object') return undefined;
  const address = (first as { address?: unknown }).address;
  if (typeof address === 'string') return clean(address);
  if (!address || typeof address !== 'object') return undefined;
  const a = address as Record<string, unknown>;
  const parts = [a.addressLocality, a.addressRegion, a.addressCountry]
    .map(clean)
    .filter((p): p is string => p !== undefined);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function fromJsonLd(root: HTMLElement): Partial<ExtractedJob> {
  const job = collectJsonLd(root).find(hasJobPostingType);
  if (!job) return {};
  const desc = clean(job.description);
  const locationType = typeof job.jobLocationType === 'string' ? job.jobLocationType.toUpperCase() : '';
  return {
    title: clean(job.title),
    company: companyFrom(job.hiringOrganization),
    location: locationFrom(job.jobLocation),
    descriptionText: desc ? (htmlToText(desc) ?? desc) : undefined,
    workplaceType: locationType === 'TELECOMMUTE' ? 'remote' : undefined,
  };
}

// ---- OpenGraph / meta tier ----
function metaContent(root: HTMLElement, selector: string): string | undefined {
  return clean(root.querySelector(selector)?.getAttribute('content'));
}

function fromMeta(root: HTMLElement): Partial<ExtractedJob> {
  return {
    title: metaContent(root, 'meta[property="og:title"]') ?? clean(root.querySelector('title')?.text),
    company: metaContent(root, 'meta[property="og:site_name"]'),
    descriptionText:
      metaContent(root, 'meta[property="og:description"]') ?? metaContent(root, 'meta[name="description"]'),
  };
}

// ---- heuristic tier (runs last; may mutate the tree) ----
function fromHeuristic(root: HTMLElement): Partial<ExtractedJob> {
  const title = clean(root.querySelector('h1')?.text);
  for (const node of root.querySelectorAll('script, style, nav, header, footer')) node.remove();
  const body = root.querySelector('body') ?? root;
  const text = body.structuredText.trim();
  return { title, descriptionText: text.length > 0 ? text.slice(0, 20_000) : undefined };
}

export function extractJobFromHtml(html: string): ExtractedJob {
  const root = parse(html);
  // Order matters: jsonld + meta read scripts/head before the heuristic strips them.
  const tiers: Array<[ExtractedJob['source'], Partial<ExtractedJob>]> = [
    ['jsonld', fromJsonLd(root)],
    ['opengraph', fromMeta(root)],
    ['heuristic', fromHeuristic(root)],
  ];

  const result: ExtractedJob = { source: 'none' };
  for (const [tier, data] of tiers) {
    let used = false;
    if (result.title === undefined && data.title !== undefined) { result.title = data.title; used = true; }
    if (result.company === undefined && data.company !== undefined) { result.company = data.company; used = true; }
    if (result.location === undefined && data.location !== undefined) { result.location = data.location; used = true; }
    if (result.descriptionText === undefined && data.descriptionText !== undefined) {
      result.descriptionText = data.descriptionText;
      used = true;
    }
    if (result.workplaceType === undefined && data.workplaceType !== undefined) {
      result.workplaceType = data.workplaceType;
      used = true;
    }
    if (used && result.source === 'none') result.source = tier;
  }
  return result;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && node --import tsx --test --test-concurrency=1 src/lib/job-url-extract.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot" && git add apps/api/package.json apps/api/package-lock.json apps/api/src/lib/job-url-extract.ts apps/api/src/lib/job-url-extract.test.ts && git commit -F - <<'EOF'
feat(api): tiered HTML job extractor (JSON-LD/OG/heuristic) (#120)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YY7NVS3QLuFeTqkmBaidAB
EOF
```

(If the repo uses a root lockfile instead of `apps/api/package-lock.json`, add whichever lockfile changed.)

---

## Task 2: SSRF guard

**Files:**
- Create: `apps/api/src/lib/url-safety.ts`
- Test: `apps/api/src/lib/url-safety.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/url-safety.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertUrlSafe, isBlockedAddress } from './url-safety';

test('isBlockedAddress flags private / loopback / link-local ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '169.254.169.254', '0.0.0.0', '::1', 'fe80::1', 'fd00::1']) {
    assert.equal(isBlockedAddress(ip), true, `${ip} should be blocked`);
  }
});

test('isBlockedAddress allows public addresses', () => {
  for (const ip of ['93.184.216.34', '1.1.1.1', '2606:2800:220:1:248:1893:25c8:1946']) {
    assert.equal(isBlockedAddress(ip), false, `${ip} should be allowed`);
  }
});

test('assertUrlSafe rejects non-http(s) schemes without resolving', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com', 'gopher://x']) {
    const result = await assertUrlSafe(url, async () => [{ address: '93.184.216.34' }]);
    assert.equal(result.ok, false);
  }
});

test('assertUrlSafe rejects hosts that resolve to a blocked address', async () => {
  const result = await assertUrlSafe('http://localhost/job', async () => [{ address: '127.0.0.1' }]);
  assert.equal(result.ok, false);
});

test('assertUrlSafe accepts a public host', async () => {
  const result = await assertUrlSafe('https://boards.greenhouse.io/x', async () => [{ address: '93.184.216.34' }]);
  assert.equal(result.ok, true);
});

test('assertUrlSafe rejects an unparseable URL', async () => {
  const result = await assertUrlSafe('not a url', async () => []);
  assert.equal(result.ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && node --import tsx --test --test-concurrency=1 src/lib/url-safety.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/api/src/lib/url-safety.ts`:

```ts
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type LookupFn = (hostname: string) => Promise<Array<{ address: string }>>;

const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true });

function isBlockedV4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  return false;
}

function isBlockedV6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0]; // drop any zone id
  if (addr === '::1' || addr === '::') return true;
  const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedV4(mapped[1]);
  if (addr.startsWith('fe80')) return true; // link-local fe80::/10
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // unique-local fc00::/7
  return false;
}

/** True when an IP literal is in a private/loopback/link-local/metadata range. */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedV4(ip);
  if (kind === 6) return isBlockedV6(ip);
  return true; // not a valid IP literal — block defensively
}

/** Validate a user-supplied URL for server-side fetching (scheme + resolved IP). */
export async function assertUrlSafe(
  rawUrl: string,
  lookup: LookupFn = defaultLookup,
): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'Enter a valid URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https URLs are supported.' };
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(url.hostname);
  } catch {
    return { ok: false, reason: 'Could not resolve that host.' };
  }
  if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
    return { ok: false, reason: 'That URL points to a private or disallowed address.' };
  }
  return { ok: true, url };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && node --import tsx --test --test-concurrency=1 src/lib/url-safety.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot" && git add apps/api/src/lib/url-safety.ts apps/api/src/lib/url-safety.test.ts && git commit -F - <<'EOF'
feat(api): SSRF guard for user-supplied fetch URLs (#120)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YY7NVS3QLuFeTqkmBaidAB
EOF
```

---

## Task 3: Guarded fetch + composition

**Files:**
- Create: `apps/api/src/lib/job-url-fetch.ts`
- Test: `apps/api/src/lib/job-url-fetch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/job-url-fetch.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { extractJobFromUrl, fetchJobPage } from './job-url-fetch';

const okSafe = async (raw: string) => ({ ok: true as const, url: new URL(raw) });

function htmlResponse(body: string, contentType = 'text/html; charset=utf-8', status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

test('fetchJobPage returns html for a safe, html, 200 page', async () => {
  const page = await fetchJobPage('https://example.com/job', {
    assertSafe: okSafe,
    fetchImpl: async () => htmlResponse('<html><body>hi</body></html>'),
  });
  assert.equal(page.blocked, undefined);
  assert.match(page.html ?? '', /hi/);
});

test('fetchJobPage blocks a non-html response', async () => {
  const page = await fetchJobPage('https://example.com/x.pdf', {
    assertSafe: okSafe,
    fetchImpl: async () => htmlResponse('%PDF', 'application/pdf'),
  });
  assert.notEqual(page.blocked, undefined);
  assert.equal(page.html, undefined);
});

test('fetchJobPage surfaces an SSRF rejection', async () => {
  const page = await fetchJobPage('http://169.254.169.254/', {
    assertSafe: async () => ({ ok: false as const, reason: 'blocked range' }),
    fetchImpl: async () => htmlResponse('should not be reached'),
  });
  assert.equal(page.blocked, 'blocked range');
});

test('fetchJobPage re-validates a redirect target', async () => {
  let calls = 0;
  const page = await fetchJobPage('https://example.com/start', {
    // First host is safe; the redirect target is rejected.
    assertSafe: async (raw) =>
      raw.includes('internal')
        ? { ok: false as const, reason: 'redirect blocked' }
        : { ok: true as const, url: new URL(raw) },
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: 'http://internal.local/' } });
    },
  });
  assert.equal(page.blocked, 'redirect blocked');
  assert.equal(calls, 1);
});

test('extractJobFromUrl maps a fetched page', async () => {
  const result = await extractJobFromUrl('https://example.com/job', {
    fetchPage: async () => ({
      html: '<html><head><meta property="og:title" content="Mapped Role"></head><body></body></html>',
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.data.title, 'Mapped Role');
});

test('extractJobFromUrl returns the block reason as an error', async () => {
  const result = await extractJobFromUrl('http://10.0.0.1/', {
    fetchPage: async () => ({ blocked: 'private address' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, 'private address');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && node --import tsx --test --test-concurrency=1 src/lib/job-url-fetch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/api/src/lib/job-url-fetch.ts`:

```ts
import { assertUrlSafe } from '@/lib/url-safety';
import { extractJobFromHtml, type ExtractedJob } from '@/lib/job-url-extract';

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

export interface FetchedPage {
  html?: string;
  blocked?: string;
}

export interface FetchDeps {
  assertSafe?: typeof assertUrlSafe;
  fetchImpl?: typeof fetch;
}

async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return Buffer.byteLength(text) > maxBytes ? null : text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Fetch a user URL behind the SSRF guard; never throws — returns `{ blocked }` on any failure. */
export async function fetchJobPage(rawUrl: string, deps: FetchDeps = {}): Promise<FetchedPage> {
  const assertSafe = deps.assertSafe ?? assertUrlSafe;
  const fetchImpl = deps.fetchImpl ?? fetch;

  let target = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const safe = await assertSafe(target);
    if (!safe.ok) return { blocked: safe.reason };

    let response: Response;
    try {
      response = await fetchImpl(safe.url, {
        redirect: 'manual', // follow manually so each hop is re-validated
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'JobOpsCopilot/1.0 (+job-autofill)', Accept: 'text/html' },
      });
    } catch {
      return { blocked: 'Could not reach that page.' };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { blocked: 'Redirect without a destination.' };
      target = new URL(location, safe.url).toString();
      continue;
    }
    if (!response.ok) return { blocked: `The page returned HTTP ${response.status}.` };
    if (!(response.headers.get('content-type') ?? '').includes('text/html')) {
      return { blocked: 'That URL is not an HTML page.' };
    }

    const html = await readCapped(response, MAX_BYTES);
    if (html === null) return { blocked: 'That page is too large to read.' };
    return { html };
  }
  return { blocked: 'Too many redirects.' };
}

export type ExtractResult = { ok: true; data: ExtractedJob } | { ok: false; error: string };

export interface ExtractDeps {
  fetchPage?: typeof fetchJobPage;
}

export async function extractJobFromUrl(url: string, deps: ExtractDeps = {}): Promise<ExtractResult> {
  const page = await (deps.fetchPage ?? fetchJobPage)(url);
  if (page.blocked !== undefined || page.html === undefined) {
    return { ok: false, error: page.blocked ?? 'Could not read that page.' };
  }
  return { ok: true, data: extractJobFromHtml(page.html) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && node --import tsx --test --test-concurrency=1 src/lib/job-url-fetch.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot" && git add apps/api/src/lib/job-url-fetch.ts apps/api/src/lib/job-url-fetch.test.ts && git commit -F - <<'EOF'
feat(api): SSRF-guarded page fetch + URL→job composition (#120)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YY7NVS3QLuFeTqkmBaidAB
EOF
```

---

## Task 4: Route + mount + verification + PR

**Files:**
- Create: `apps/api/src/routes/job-extract.ts`
- Create: `apps/api/src/routes/job-extract.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write the failing route test**

Create `apps/api/src/routes/job-extract.test.ts`:

```ts
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createJobExtractRouter } from './job-extract';
import type { ExtractResult } from '@/lib/job-url-fetch';

async function withServer(
  mount: (app: express.Express) => void,
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    const header = request.header('X-User-Id');
    if (header) request.userId = header.trim();
    next();
  });
  mount(app);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('no server address');
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function mountExtract(extract: (url: string) => Promise<ExtractResult>) {
  return (app: express.Express) => app.use('/api/jobs', createJobExtractRouter({ extract }));
}

test('POST /api/jobs/extract requires a signed-in user', async () => {
  await withServer(mountExtract(async () => ({ ok: true, data: { source: 'none' } })), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/jobs/extract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://x/y' }),
    });
    assert.equal(response.status, 401);
  });
});

test('POST /api/jobs/extract returns extracted fields', async () => {
  await withServer(
    mountExtract(async () => ({ ok: true, data: { title: 'AI Engineer', source: 'jsonld' } })),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/jobs/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-User-Id': 'u1' },
        body: JSON.stringify({ url: 'https://x/y' }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.title, 'AI Engineer');
      assert.equal(body.source, 'jsonld');
    },
  );
});

test('POST /api/jobs/extract returns 400 for a blocked URL', async () => {
  await withServer(
    mountExtract(async () => ({ ok: false, error: 'private address' })),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/jobs/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-User-Id': 'u1' },
        body: JSON.stringify({ url: 'http://10.0.0.1/' }),
      });
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.error, 'private address');
    },
  );
});

test('POST /api/jobs/extract returns 400 when url is missing', async () => {
  await withServer(mountExtract(async () => ({ ok: true, data: { source: 'none' } })), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/jobs/extract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-User-Id': 'u1' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && node --import tsx --test --test-concurrency=1 src/routes/job-extract.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the router**

Create `apps/api/src/routes/job-extract.ts`:

```ts
import { Router } from 'express';
import { requireUser } from '@/lib/auth';
import { extractJobFromUrl, type ExtractResult } from '@/lib/job-url-fetch';

export interface JobExtractDeps {
  extract: (url: string) => Promise<ExtractResult>;
}

const defaultDeps: JobExtractDeps = { extract: (url) => extractJobFromUrl(url) };

/** `POST /api/jobs/extract` — fetch a job URL and return autofill fields. */
export function createJobExtractRouter(deps: JobExtractDeps = defaultDeps) {
  const router = Router();

  router.post('/extract', async (request, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) return;

    const url = typeof request.body?.url === 'string' ? request.body.url.trim() : '';
    if (!url) {
      response.status(400).json({ error: 'A job URL is required.' });
      return;
    }

    try {
      const result = await deps.extract(url);
      if (!result.ok) {
        response.status(400).json({ error: result.error });
        return;
      }
      response.json(result.data);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const jobExtractRouter = createJobExtractRouter();
```

- [ ] **Step 4: Run the route test to verify it passes**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && node --import tsx --test --test-concurrency=1 src/routes/job-extract.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Mount the router in `app.ts`**

In `apps/api/src/app.ts`, add the import next to the other route imports (match the existing import style):

```ts
import { jobExtractRouter } from '@/routes/job-extract';
```

Then mount it immediately BEFORE the existing `app.use('/api/jobs', jobsRouter);` line so `/extract` is matched here and all other `/api/jobs/*` paths fall through to `jobsRouter`:

```ts
  app.use('/api/jobs', jobExtractRouter);
  app.use('/api/jobs', jobsRouter);
```

- [ ] **Step 6: Full verification**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && npm run typecheck`
Expected: no errors.

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && npm run lint`
Expected: no errors.

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && node scripts/run-tests.mjs`
Expected: all PASS (prior suite + the 4 new test files).

- [ ] **Step 7: Commit, push, open PR**

```bash
cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot" && git add apps/api/src/routes/job-extract.ts apps/api/src/routes/job-extract.test.ts apps/api/src/app.ts && git commit -F - <<'EOF'
feat(api): POST /api/jobs/extract autofill endpoint (#120)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YY7NVS3QLuFeTqkmBaidAB
EOF
git push -u origin feat/job-url-extract
```

Then open the PR (base `main`), title `feat: server-side job-URL extract endpoint (#118 → #120 · PR A)`, body summarising the endpoint + SSRF guard + tiered extraction, ending with the Generated-with line.

---

## Self-review notes
- **Spec coverage:** task 3.1 (server fetch + extraction + SSRF + timeouts/non-HTML) = Tasks 1–4; the field mapping (title/company/location/description/workplace) = Task 1. PR B covers 3.2 (form mapping/UX).
- **Type consistency:** `ExtractedJob` (with `source`) defined in `job-url-extract.ts` and re-used in `job-url-fetch.ts` + route; `ExtractResult` discriminated union (`ok`) defined once in `job-url-fetch.ts` and consumed by the route + its test; `assertUrlSafe` returns `{ ok, url }|{ ok, reason }`; `fetchJobPage` returns `{ html }|{ blocked }`.
- **No placeholders:** every step has full code + exact commands.
- **Offline tests:** all I/O is injected (`assertSafe`/`fetchImpl`/`fetchPage`/`extract`); no test hits the network or DNS.
- **Security:** SSRF guard re-validates every redirect hop (`redirect: 'manual'`), blocks non-http(s) schemes, private/loopback/link-local/metadata ranges (incl. `169.254.169.254`), caps size (2 MB) + time (8 s), and requires `text/html`.
