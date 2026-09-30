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
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
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

// #347: the proxy is the browser's only way into the API, so it refuses cross-site writes,
// forwards only the routes the client calls, and bounds what it buffers and waits for.
async function callProxy(
  path: string[],
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit; duplex?: 'half' } = {},
) {
  const route = await import('./[...path]/route');
  const method = init.method ?? 'GET';
  const request = new NextRequest(`http://localhost:3000/api/proxy/${path.map(encodeURIComponent).join('/')}`, {
    method,
    headers: init.headers,
    body: init.body,
    ...(init.duplex ? { duplex: init.duplex } : {}),
  } as ConstructorParameters<typeof NextRequest>[1]);
  const handler = route[method as 'GET' | 'POST' | 'PATCH' | 'DELETE'];
  return handler(request, { params: Promise.resolve({ path }) });
}

function okUpstream() {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const SAME_ORIGIN_POST = { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, body: '{}' };

it('refuses a cross-site write with 403 and never calls the API', async () => {
  const fetchMock = okUpstream();

  const response = await callProxy(['api', 'demo', 'clear'], {
    method: 'POST',
    headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
    body: '{}',
  });

  expect(response.status).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('forwards a same-origin write, judged by Sec-Fetch-Site or, without it, by Origin', async () => {
  const fetchMock = okUpstream();
  const post = (headers: Record<string, string>) => callProxy(['api', 'jobs'], { method: 'POST', headers, body: '{}' });

  expect((await post({ 'sec-fetch-site': 'same-origin' })).status).toBe(200);
  expect((await post({ origin: 'http://localhost:3000' })).status).toBe(200);
  expect((await post({ origin: 'https://evil.example' })).status).toBe(403);
  expect((await post({ 'sec-fetch-site': 'same-site', origin: 'https://other.azurewebsites.net' })).status).toBe(403);
  expect((await post({})).status).toBe(403);
  // A read needs no origin check.
  expect((await callProxy(['api', 'jobs'])).status).toBe(200);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('forwards only the API routes the web client calls: 404 for the rest, with no upstream call', async () => {
  const fetchMock = okUpstream();

  expect((await callProxy(['internal', 'discovery', 'run'], SAME_ORIGIN_POST)).status).toBe(404);
  expect((await callProxy(['api', 'n8n', 'job-intake'], SAME_ORIGIN_POST)).status).toBe(404);
  expect((await callProxy(['api', 'ext', 'verify'])).status).toBe(404);
  expect((await callProxy(['api', 'ext-tokens'])).status).toBe(404);
  expect((await callProxy(['api', 'jobs', '..', '..', 'internal', 'discovery', 'run'], SAME_ORIGIN_POST)).status).toBe(404);
  expect((await callProxy(['api', 'profile-evil'])).status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('re-encodes each path segment, so a decoded "?" cannot inject a query', async () => {
  const fetchMock = okUpstream();

  await callProxy(['api', 'jobs', 'abc?admin=1']);

  expect(fetchMock.mock.calls[0]![0]).toBe('http://127.0.0.1:4000/api/jobs/abc%3Fadmin%3D1');
});

it('refuses a body over 6 MB with 413, by content-length or while streaming', async () => {
  const fetchMock = okUpstream();
  const big = new Uint8Array(7 * 1024 * 1024);

  const declared = await callProxy(['api', 'profile', 'resume'], {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin', 'content-length': String(big.length) },
    body: big,
  });
  expect(declared.status).toBe(413);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < 7; i += 1) controller.enqueue(new Uint8Array(1024 * 1024));
      controller.close();
    },
  });
  const streamed = await callProxy(['api', 'profile', 'resume'], {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin' },
    body: stream,
    duplex: 'half',
  });
  expect(streamed.status).toBe(413);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('answers 502 JSON when the API is unreachable and 504 when it is too slow', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
  const down = await callProxy(['api', 'jobs']);
  expect(down.status).toBe(502);
  expect(await down.json()).toEqual({ error: 'API unreachable' });

  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' })),
  );
  const slow = await callProxy(['api', 'jobs']);
  expect(slow.status).toBe(504);
  expect(await slow.json()).toEqual({ error: 'The API took too long to answer.' });
});

it('passes Retry-After and RateLimit headers through, so the browser can back off on 429', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response('{"error":"Too many requests"}', {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '30',
          'ratelimit-limit': '20',
          'ratelimit-remaining': '0',
          'ratelimit-reset': '30',
          'ratelimit-policy': '20;w=60',
        },
      }),
    ),
  );

  const response = await callProxy(['api', 'ai', 'score-fit'], SAME_ORIGIN_POST);

  expect(response.status).toBe(429);
  expect(response.headers.get('retry-after')).toBe('30');
  expect(response.headers.get('ratelimit-remaining')).toBe('0');
  expect(response.headers.get('ratelimit-policy')).toBe('20;w=60');
});
