import assert from 'node:assert/strict';
import test from 'node:test';
import { asyncHandler } from './async-handler';

test('asyncHandler forwards a rejected promise to next()', async () => {
  const boom = new Error('boom');
  let received: unknown;
  const handler = asyncHandler(async () => {
    throw boom;
  });

  await new Promise<void>((resolve) => {
    handler({} as never, {} as never, ((err: unknown) => {
      received = err;
      resolve();
    }) as never);
  });

  assert.equal(received, boom);
});

test('asyncHandler does not forward anything when the handler resolves', async () => {
  const forwarded: unknown[] = [];
  const handler = asyncHandler(async () => {
    /* resolves without touching next */
  });

  handler({} as never, {} as never, ((err?: unknown) => {
    if (err) forwarded.push(err);
  }) as never);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(forwarded.length, 0);
});
