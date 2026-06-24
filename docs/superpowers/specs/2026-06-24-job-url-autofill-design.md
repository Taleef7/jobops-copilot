# Phase 3 — Add-a-job autofill from URL (design)

**Date:** 2026-06-24
**Epic:** #124 · **Phase issue:** #120
**Status:** Approved (brainstorm), pending implementation plan

## Goal

Paste a job URL in `/jobs/new` → the app fetches the page server-side and
**autofills** title, company, location, description, and workplace type, instead
of manual paste. **Best-effort and always editable** — unsupported pages fall
back to manual entry with a clear message.

## Locked decisions

1. **Extraction = lightweight parser (`node-html-parser`), tiered: JSON-LD
   `JobPosting` → OpenGraph/meta → main-text heuristic.** Covers the high-value
   structured-data case (Greenhouse / Lever / Ashby) with broad fallback at
   minimal dependency weight. No headless browser, no per-ATS scrapers, no LLM.
2. **Server-side fetch with a hard SSRF guard** (arbitrary user URLs are
   fetched, so this is a security requirement, not a nice-to-have).
3. **UX = explicit "Autofill" button** next to the URL field; overwrites the
   mapped fields on click; graceful inline fallback when extraction is thin.

## Current state (verified)

- `apps/web/src/components/job-create-form.tsx` stores the URL as plain text;
  the description must be pasted manually. No fetching/scraping exists.
- The API has **no HTML parser** (deps: express, pg, pdf-parse, multer, helmet,
  …). Node 20+ global `fetch` is available. Job sources (Adzuna/Remotive) fetch
  JSON APIs, not HTML — no reusable HTML extraction.
- Routes are mounted in `apps/api/src/app.ts`; `/api/jobs` → `jobsRouter`.

## Architecture

### New endpoint — `POST /api/jobs/extract`

Mounted on the existing `jobsRouter` (auth-required like the rest of `/api/jobs`).

- **Request:** `{ url: string }`.
- **Response:** `ExtractedJob` —
  ```ts
  interface ExtractedJob {
    title?: string;
    company?: string;
    location?: string;
    descriptionText?: string;
    workplaceType?: 'remote' | 'hybrid' | 'onsite' | 'flexible';
    source: 'jsonld' | 'opengraph' | 'heuristic' | 'none';
  }
  ```
  Every content field is optional; the client autofills whatever is present.
  `source` reports which tier produced the result (for an honest UI message).
- **Errors:** invalid/blocked/oversized/non-HTML URL → `400` with a clear
  message (or a `200` with `source: 'none'` and no fields — see Error handling).

### New module — `apps/api/src/lib/job-url-extract.ts`

Two units with clear boundaries:

**1. `extractJobFromHtml(html: string, pageUrl: string): ExtractedJob`** — pure,
no I/O, fully unit-testable against fixture HTML. Tiered, first hit wins per
field (later tiers only fill gaps):
- **JSON-LD** — parse every `<script type="application/ld+json">` block; find an
  object (or `@graph` member) with `@type` `JobPosting`. Map: `title`;
  `hiringOrganization.name` → company; `jobLocation.address` (locality/region/
  country, joined) → location; `description` → descriptionText (HTML stripped to
  text); `jobLocationType === 'TELECOMMUTE'` → workplaceType `remote`. Malformed
  JSON in a block is skipped, never thrown.
- **OpenGraph / meta** (fills any field JSON-LD missed) — `og:title` / `<title>`
  → title; `og:site_name` → company; `og:description` / `<meta name=description>`
  → descriptionText.
- **Heuristic** (last resort for descriptionText/title) — strip `<script>` and
  `<style>`, take the `<h1>` as title and the largest visible text block as
  descriptionText.
- `source` = the highest tier that produced any field (`jsonld` > `opengraph` >
  `heuristic`), or `none` when nothing usable was found.

**2. `fetchJobPage(url: string): Promise<{ html: string } | { blocked: string }>`**
— the guarded I/O:
- Allow only `http`/`https` schemes; reject anything else.
- **SSRF guard:** resolve the hostname and reject private / loopback /
  link-local / metadata ranges — `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`,
  `192.168.0.0/16`, `169.254.0.0/16` (incl. `169.254.169.254`), `::1`, `fc00::/7`,
  `fe80::/10`, and `0.0.0.0`. Re-check after each redirect; cap redirects (≤3).
- `AbortSignal.timeout(8000)`; a `User-Agent` header; read the body with a
  **2 MB cap** (abort if exceeded); require a `text/html` content-type.
- Any failure (DNS, timeout, blocked range, non-HTML, oversize, non-2xx) returns
  `{ blocked: <reason> }` rather than throwing.

The route composes them: `fetchJobPage` → on `{ html }` call `extractJobFromHtml`;
on `{ blocked }` return the clean error.

### Frontend

- **`apps/web/src/lib/api.ts`** — add `extractJobFromUrl(url: string):
  Promise<ExtractedJob>` hitting `POST /api/jobs/extract`.
- **`apps/web/src/components/job-create-form.tsx`** — an **"Autofill"** button
  beside the Job URL field, disabled until the URL parses as `http(s)`. On
  click: loading state ("Reading posting…") → on success populate `title`,
  `company`, `location`, `descriptionText`, `workplaceType` from the returned
  fields (overwrite; the user edits before saving) and toast *"Autofilled from
  {source} — review before saving."* On `source: 'none'` / no usable fields:
  inline message *"Couldn't read that posting automatically — paste the
  description below."* The form stays fully manual; the URL is still saved.

## Error handling

- Blocked/invalid URL (SSRF, bad scheme, non-HTML, oversize, timeout, non-2xx):
  route returns `400 { error }`; the form shows the inline fallback message.
- Thin extraction (page fetched but nothing useful): `200 { source: 'none' }`;
  same inline fallback. (We distinguish "couldn't fetch" from "fetched but
  empty" but the user message is the same — both mean "type it yourself".)
- Malformed JSON-LD: skipped silently; extraction continues with lower tiers.

## Testing

- `job-url-extract.test.ts` (pure) — fixtures: full JSON-LD `JobPosting`
  (all fields + `source:'jsonld'`); OG-only page (`source:'opengraph'`); bare
  HTML (heuristic title/desc or `none`); malformed JSON-LD block (no throw,
  falls through); `TELECOMMUTE` → `remote`.
- SSRF unit tests — `http://169.254.169.254`, `http://localhost`,
  `http://10.0.0.1`, `file:///etc/passwd`, `ftp://…` all return `{ blocked }`.
- Route test — `POST /api/jobs/extract` with a mocked `fetchJobPage`/fetch:
  maps fields on success; returns a clean `400` for a blocked URL.
- Web (vitest) — Autofill populates the form fields on a successful response;
  shows the fallback message on `source: 'none'`; button disabled for a
  non-URL value.

## Build slices — 2 PRs off `main`

| PR | Scope | Layer |
|----|-------|-------|
| **A** | `job-url-extract.ts` (extract + SSRF-guarded fetch) + `POST /api/jobs/extract` + tests; add `node-html-parser` dep | backend (TDD) |
| **B** | `extractJobFromUrl` client + Autofill button/UX in the create form + tests | frontend |

## YAGNI (out of scope)

No headless browser / JS rendering, no per-ATS custom scrapers, no caching, no
screenshots, no LLM cleanup of extracted text, no auto-trigger on paste (explicit
button only), no bulk/multi-URL import.

## Workflow

Branch each slice off `main`; one PR per slice; address Codex review before
proceeding; owner merges. Verify per `docs/TESTING.md`.
