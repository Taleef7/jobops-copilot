import assert from 'node:assert/strict';
import test from 'node:test';
import { runGracefulShutdown } from '@/lib/shutdown';

const noop = () => {};

test('runGracefulShutdown drains the server then the pool, then exits 0', async () => {
  const order: string[] = [];
  let exitCode: number | undefined;

  await runGracefulShutdown({
    closeServer: async () => {
      order.push('server');
    },
    closePool: async () => {
      order.push('pool');
    },
    onExit: (code) => {
      exitCode = code;
    },
    log: noop,
  });

  assert.deepEqual(order, ['server', 'pool']);
  assert.equal(exitCode, 0);
});

test('runGracefulShutdown flushes telemetry after the server drains, before the pool', async () => {
  const order: string[] = [];

  await runGracefulShutdown({
    closeServer: async () => {
      order.push('server');
    },
    flushTelemetry: async () => {
      order.push('flush');
    },
    closePool: async () => {
      order.push('pool');
    },
    onExit: noop,
    log: noop,
  });

  assert.deepEqual(order, ['server', 'flush', 'pool']);
});

test('runGracefulShutdown exits 1 when draining throws', async () => {
  let exitCode: number | undefined;

  await runGracefulShutdown({
    closeServer: async () => {},
    closePool: async () => {
      throw new Error('pool stuck');
    },
    onExit: (code) => {
      exitCode = code;
    },
    log: noop,
  });

  assert.equal(exitCode, 1);
});

test('runGracefulShutdown force-exits 1 when the drain hangs past the timeout', async () => {
  let exitCode: number | undefined;
  // A stuck connection: closeServer doesn't resolve until we release it. The force-exit
  // timer must fire first (exit 1); we release afterwards so the promise still settles
  // cleanly (in production process.exit ends it, but the test must not dangle).
  let releaseServer = () => {};
  const serverStuck = new Promise<void>((resolve) => {
    releaseServer = resolve;
  });

  const run = runGracefulShutdown({
    closeServer: () => serverStuck,
    closePool: async () => {},
    onExit: (code) => {
      exitCode ??= code;
    },
    timeoutMs: 20,
    log: noop,
  });

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(exitCode, 1); // force-exit fired while the server was still draining

  releaseServer();
  await run; // settles without a dangling promise; the late exit(0) is a no-op (settled)
});

test('runGracefulShutdown calls onExit at most once', async () => {
  let exitCalls = 0;

  await runGracefulShutdown({
    closeServer: async () => {},
    closePool: async () => {},
    onExit: () => {
      exitCalls += 1;
    },
    timeoutMs: 5,
    log: noop,
  });

  // Give the (already-cleared) timeout a tick to prove it can't double-fire.
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(exitCalls, 1);
});
