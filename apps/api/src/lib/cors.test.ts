import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedOrigins, corsOptions } from './cors';

test('falls back to local dev origins when unconfigured', () => {
  const origins = allowedOrigins({} as NodeJS.ProcessEnv);
  assert.deepEqual(origins, ['http://localhost:3000', 'http://127.0.0.1:3000']);
});

test('parses a comma-separated allowlist, trimming blanks', () => {
  const origins = allowedOrigins({
    CORS_ALLOWED_ORIGINS: 'https://app.example.com, https://www.example.com ,',
  } as NodeJS.ProcessEnv);
  assert.deepEqual(origins, ['https://app.example.com', 'https://www.example.com']);
});

function check(env: NodeJS.ProcessEnv, origin: string | undefined): boolean {
  const { origin: originFn } = corsOptions(env);
  assert.equal(typeof originFn, 'function');
  let allowed = false;
  (originFn as (o: string | undefined, cb: (e: Error | null, ok?: boolean) => void) => void)(
    origin,
    (_err, ok) => {
      allowed = Boolean(ok);
    },
  );
  return allowed;
}

test('allows an origin on the allowlist, denies others, and allows no-Origin callers', () => {
  const env = { CORS_ALLOWED_ORIGINS: 'https://app.example.com', NODE_ENV: 'production' } as NodeJS.ProcessEnv;
  assert.equal(check(env, 'https://app.example.com'), true);
  assert.equal(check(env, 'https://evil.example.com'), false);
  assert.equal(check(env, 'chrome-extension://abcdefghijklmno'), true);
  assert.equal(check(env, 'moz-extension://abcdefghijklmno'), true);
  // No Origin header (curl, server-to-server, same-origin) is allowed.
  assert.equal(check(env, undefined), true);
});

test('allows arbitrary localhost / 127.0.0.1 origins in non-production', () => {
  const env = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;
  assert.equal(check(env, 'http://localhost:56088'), true);
  assert.equal(check(env, 'http://127.0.0.1:45678'), true);
  assert.equal(check(env, 'https://evil.example.com'), false);
});
