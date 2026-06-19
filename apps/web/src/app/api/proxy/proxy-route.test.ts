import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';

// The proxy attaches auth server-side. Mock Clerk so we control the token.
vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ getToken: async () => 'session-token' })),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('injects the Clerk bearer token + shared secret and forwards to the API, never to the browser', async () => {
  // stubEnv (not raw process.env writes) so unstubAllEnvs restores them after the test.
  vi.stubEnv('API_SHARED_SECRET', 'sh4red-secret');
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.internal:4000');
  vi.resetModules(); // re-import so the route re-reads the env above at module load

  // The upstream returns hostile headers; the handler must only pass content-type/
  // content-disposition through, never the secret or a Set-Cookie back to the browser.
  const fetchMock = vi.fn().mockResolvedValue(
    new Response('{"ok":true}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'leaked-secret',
        'set-cookie': 'session=abc',
      },
    }),
  );
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

  // The hostile upstream headers are stripped (only content-type/-disposition pass through),
  // so no secret or Set-Cookie reaches the browser.
  expect(response.headers.get('x-api-key')).toBeNull();
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(response.headers.get('content-type')).toBe('application/json');
});
