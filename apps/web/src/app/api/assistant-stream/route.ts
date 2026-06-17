import { auth } from '@clerk/nextjs/server';
import type { NextRequest } from 'next/server';

/**
 * Streaming proxy to the Express assistant SSE route (Phase 3 · Workstream M).
 *
 * The catch-all `/api/proxy` route buffers (`await upstream.arrayBuffer()`) and cannot
 * stream SSE, so the assistant stream gets its own route that attaches the Clerk token +
 * shared secret server-side and returns the upstream `ReadableStream` **unbuffered**.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const SHARED_SECRET = process.env.API_SHARED_SECRET?.trim();

export async function POST(request: NextRequest) {
  const headers = new Headers();
  headers.set('content-type', 'application/json');

  const { getToken } = await auth();
  const token = await getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (SHARED_SECRET) headers.set('x-api-key', SHARED_SECRET);

  const upstream = await fetch(`${API_BASE}/api/ai/assistant/stream`, {
    method: 'POST',
    headers,
    body: await request.arrayBuffer(),
    cache: 'no-store',
  });

  // Pass the stream through untouched (do NOT buffer with arrayBuffer()).
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
    },
  });
}
