import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';

// The proxy attaches auth server-side. Mock Clerk so we control the token.
vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ getToken: async () => 'session-token' })),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('injects the Clerk bearer token + shared secret and forwards to the API, never to the browser', async () => {
  process.env.API_SHARED_SECRET = 'sh4red-secret';
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://api.internal:4000';
  vi.resetModules(); // re-import so the route re-reads the env above at module load

  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);

  const { POST } = await import('./[...path]/route');

  const request = new NextRequest('http://localhost:3000/api/proxy/api/ai/score-fit?debug=1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ job_id: 'j1' }),
  });

  const response = await POST(request, { params: Promise.resolve({ path: ['api', 'ai', 'score-fit'] }) });
  expect(response.status).toBe(200);

  // Upstream call: correct target (incl. query) and injected auth headers.
  const [target, init] = fetchMock.mock.calls[0]!;
  expect(target).toBe('http://api.internal:4000/api/ai/score-fit?debug=1');
  const headers = init.headers as Headers;
  expect(headers.get('authorization')).toBe('Bearer session-token');
  expect(headers.get('x-api-key')).toBe('sh4red-secret');

  // The secret must not leak back to the browser in the proxied response.
  expect(response.headers.get('x-api-key')).toBeNull();
  expect(response.headers.get('authorization')).toBeNull();
});
