import { auth } from '@clerk/nextjs/server';
import type { NextRequest } from 'next/server';

/**
 * Server-side proxy to the Express API.
 *
 * Client components call `/api/proxy/<api-path>` (same-origin); this handler
 * attaches the Clerk session token and the shared secret server-side, so the
 * token is never exposed to the browser and there is one auth choke point.
 * Server components call the Express API directly (see lib/api.ts).
 */

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const SHARED_SECRET = process.env.API_SHARED_SECRET?.trim();

async function handler(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const target = `${API_BASE}/${path.join('/')}${request.nextUrl.search}`;

  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  const { getToken } = await auth();
  const token = await getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (SHARED_SECRET) headers.set('x-api-key', SHARED_SECRET);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? await request.arrayBuffer() : undefined;

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body,
    redirect: 'manual',
    cache: 'no-store',
  });

  const responseHeaders = new Headers();
  for (const key of ['content-type', 'content-disposition']) {
    const value = upstream.headers.get(key);
    if (value) responseHeaders.set(key, value);
  }

  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
