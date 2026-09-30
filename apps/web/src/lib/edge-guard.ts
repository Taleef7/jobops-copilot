import type { NextRequest } from 'next/server';

/**
 * Guards for the route handlers that forward browser requests to the Express API (#347):
 * the proxy and the assistant routes. Server-only.
 */

/** The résumé upload's 5 MB limit plus the multipart envelope. */
export const MAX_FORWARDED_BODY_BYTES = 6 * 1024 * 1024;
export const UPSTREAM_TIMEOUT_MS = 90_000;

const json = (status: number, error: string) => Response.json({ error }, { status });

/**
 * The origin this app is served from: `APP_ORIGIN` when set, else the request's own host.
 * A browser always sends the real host, so a cross-site page can't make these match.
 */
export function appOrigin(request: NextRequest): string {
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host;
  const proto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(/:$/, '');
  return `${proto.split(',')[0]!.trim()}://${host.split(',')[0]!.trim()}`;
}

/**
 * A 403 for a write that didn't come from this app's own pages, else null. The session
 * cookie rides along on cross-site requests, so a write needs `Sec-Fetch-Site:
 * same-origin` (or `none`, typed by the user), or an `Origin` equal to this app's.
 * Reads pass: they change nothing.
 */
export function refuseCrossSiteWrite(request: NextRequest): Response | null {
  if (request.method === 'GET' || request.method === 'HEAD') return null;
  const site = request.headers.get('sec-fetch-site');
  if (site === 'same-origin' || site === 'none') return null;
  const origin = request.headers.get('origin');
  if (origin && origin === appOrigin(request)) return null;
  return json(403, 'This request did not come from JobOps Copilot.');
}

/** The request body, or a 413 once it passes the limit (declared or counted while reading). */
export async function readBoundedBody(
  request: NextRequest,
  maxBytes = MAX_FORWARDED_BODY_BYTES,
): Promise<ArrayBuffer | undefined | Response> {
  if (request.method === 'GET' || request.method === 'HEAD' || !request.body) return undefined;
  const tooLarge = () => json(413, `The request is too large. The limit is ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return tooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

/**
 * `fetch` to the API, which has 90 s to start answering. The limit ends once the response
 * headers arrive, so an assistant stream can run longer. `refused` is this app's own
 * answer when the API is too slow (504) or can't be reached (502), to return as is.
 */
export async function fetchUpstream(
  url: string,
  init: RequestInit,
): Promise<{ upstream: Response; refused?: never } | { refused: Response; upstream?: never }> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('The API took too long to answer.', 'TimeoutError')),
    UPSTREAM_TIMEOUT_MS,
  );
  try {
    return { upstream: await fetch(url, { ...init, signal: controller.signal }) };
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') return { refused: json(504, 'The API took too long to answer.') };
    return { refused: json(502, 'API unreachable') };
  } finally {
    clearTimeout(timer);
  }
}
