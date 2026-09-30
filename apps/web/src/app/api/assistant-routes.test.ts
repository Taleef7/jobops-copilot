import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ getToken: async () => 'session-token' })),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// #347: the assistant routes start paid LLM calls with the user's session, so they take the
// same guard as the proxy: same-origin writes only, a bounded body, and a time limit.
const ROUTES = {
  'assistant-stream': () => import('./assistant-stream/route'),
  'assistant-chat': () => import('./assistant-chat/route'),
};

function post(name: string, headers: Record<string, string>, body: BodyInit = '{"message":"hi"}') {
  return new NextRequest(`http://localhost:3000/api/${name}`, { method: 'POST', headers, body });
}

describe.each(Object.entries(ROUTES))('/api/%s', (name, load) => {
  it('refuses a cross-site request without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { POST } = await load();

    const response = await POST(post(name, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards a same-origin request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { POST } = await load();

    const response = await POST(post(name, { 'sec-fetch-site': 'same-origin' }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a body over the limit and answers 502 when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const { POST } = await load();

    const big = new Uint8Array(7 * 1024 * 1024);
    const tooLarge = await POST(post(name, { 'sec-fetch-site': 'same-origin', 'content-length': String(big.length) }, big));
    expect(tooLarge.status).toBe(413);

    const down = await POST(post(name, { 'sec-fetch-site': 'same-origin' }));
    expect(down.status).toBe(502);
  });
});
