import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent } from 'undici';
import { assertUrlSafe, isBlockedAddress } from '@/lib/url-safety';
import { extractJobFromHtml, type ExtractedJob } from '@/lib/job-url-extract';

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

/** A pre-fetch SSRF check is point-in-time; the OS re-resolves the host when
 *  `fetch` connects, so a hostile host can rebind DNS to a private IP between
 *  the two. This connect-time guard re-checks the address actually being
 *  connected to (and undici connects to exactly that address), closing the gap. */
export function anyAddressBlocked(addresses: ReadonlyArray<{ address: string }>): boolean {
  return addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address));
}

const safeLookup = (
  hostname: string,
  options: { all?: boolean } & Record<string, unknown>,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as LookupAddress[];
    if (anyAddressBlocked(list)) {
      return callback(Object.assign(new Error('Blocked address'), { code: 'EAI_FAIL' }), []);
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
};

// Reused dispatcher: every connection it makes is vetted at connect time.
// (Cast bridges Node's overloaded LookupFunction signature to our handler.)
const safeDispatcher = new Agent({ connect: { lookup: safeLookup as unknown as LookupFunction } });

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
    // Body-less Response — only test doubles hit this; Node's fetch always
    // streams, so the streamed path below is what bounds memory in production.
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
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'JobOpsCopilot/1.0 (+job-autofill)', Accept: 'text/html' },
        // undici reads `dispatcher`; the connect-time guard pins a vetted IP.
        // Cast via unknown: `dispatcher` isn't in the DOM RequestInit type, and
        // undici/undici-types versions differ structurally.
        dispatcher: safeDispatcher,
      } as unknown as RequestInit);
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
    // Reject an explicit non-HTML type, but allow a missing content-type: some
    // job boards omit it, and the extractor degrades to source:'none' on junk.
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (contentType && contentType !== 'text/html') {
      return { blocked: 'That URL is not an HTML page.' };
    }

    // Body read can still fail after headers arrive (timeout mid-stream, socket
    // reset); keep the "never throws" contract by turning it into a block.
    let html: string | null;
    try {
      html = await readCapped(response, MAX_BYTES);
    } catch {
      return { blocked: 'Could not finish reading that page.' };
    }
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
