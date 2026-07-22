import assert from 'node:assert/strict';
import test from 'node:test';
import { registerProcessSafetyNet } from './process-safety';

test('registerProcessSafetyNet logs an unhandled rejection instead of letting it crash', () => {
  const calls: unknown[][] = [];
  const before = process.listeners('unhandledRejection').slice();

  registerProcessSafetyNet({ error: (...args: unknown[]) => calls.push(args) });

  const added = process.listeners('unhandledRejection').filter((listener) => !before.includes(listener));
  try {
    assert.equal(added.length, 1);
    (added[0] as (reason: unknown, promise: Promise<unknown>) => void)('boom', Promise.resolve());
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.map(String).join(' '), /boom/);
  } finally {
    for (const listener of added) process.off('unhandledRejection', listener as never);
  }
});
