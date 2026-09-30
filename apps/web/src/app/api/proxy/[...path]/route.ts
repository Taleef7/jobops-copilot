import { auth } from '@clerk/nextjs/server';
import type { NextRequest } from 'next/server';
import { isProxyPathAllowed } from '../allowed-paths';
import { fetchUpstream, readBoundedBody, refuseCrossSiteWrite } from '@/lib/edge-guard';

/**
 * Server-side proxy to the Express API.
 *
 * Client components call `/api/proxy/<api-path>` (same-origin); this handler
 * attaches the Clerk session token and the shared secret server-side, so the
 * token is never exposed to the browser and there is one auth choke point.
 * Server components call the Express API directly (see lib/api.ts).
 *
 * It forwards only the routes the client calls, refuses cross-site writes, caps the
 * body, and gives the API 90 s (#347).
 */

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const SHARED_SECRET = process.env.API_SHARED_SECRET?.trim();

// x-total-count carries the unpaginated list total so the client can page; Retry-After and
// the RateLimit-* headers let it back off on a 429.
const PASSED_BACK = /^(content-type|content-disposition|x-total-count|retry-after|ratelimit-[a-z]+)$/;

async function handler(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!isProxyPathAllowed(path)) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  const crossSite = refuseCrossSiteWrite(request);
  if (crossSite) return crossSite;
  const body = await readBoundedBody(request);
  if (body instanceof Response) return body;

  const target = `${API_BASE}/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;

  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  const { getToken } = await auth();
  const token = await getToken();
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  } else if (process.env.NODE_ENV !== 'production') {
    headers.set('x-user-id', process.env.DEV_USER_ID?.trim() || 'user_local_dev');
  }
  if (SHARED_SECRET) headers.set('x-api-key', SHARED_SECRET);

  const { upstream, refused } = await fetchUpstream(target, {
    method: request.method,
    headers,
    body,
    redirect: 'manual',
    cache: 'no-store',
  });
  if (refused) return refused;

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (PASSED_BACK.test(key)) responseHeaders.set(key, value);
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
