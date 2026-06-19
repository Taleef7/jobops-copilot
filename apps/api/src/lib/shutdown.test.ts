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
  const exited = new Promise<void>((resolve) => {
    void runGracefulShutdown({
      closeServer: () => new Promise<void>(() => {}), // never resolves (stuck connection)
      closePool: async () => {},
      onExit: (code) => {
        exitCode = code;
        resolve();
      },
      timeoutMs: 20,
      log: noop,
    });
  });

  await exited;
  assert.equal(exitCode, 1);
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
