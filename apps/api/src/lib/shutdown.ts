import type { Server } from 'node:http';
import { closePool } from '@/lib/postgres';

/**
 * Graceful shutdown (QA·E). Azure App Service sends SIGTERM on every deploy/restart;
 * without a handler, in-flight requests are dropped and the Postgres pool is never
 * drained. This stops accepting new connections, lets in-flight requests finish, closes
 * the pool, then exits — with a hard timeout so a stuck connection can't hang the deploy.
 */

export interface ShutdownDeps {
  /** Stop accepting connections and resolve once in-flight requests have drained. */
  closeServer: () => Promise<void>;
  /** Drain the database pool. */
  closePool: () => Promise<void>;
  /** Terminate the process (injected for testability). */
  onExit: (code: number) => void;
  /** Force-exit budget if draining hangs (default 10s). */
  timeoutMs?: number;
  log?: (message: string) => void;
}

/** Orchestrate the drain → close-pool → exit sequence. Pure of process/signal wiring. */
export async function runGracefulShutdown(deps: ShutdownDeps): Promise<void> {
  const { closeServer, closePool: drainPool, onExit, timeoutMs = 10_000 } = deps;
  const log = deps.log ?? ((message: string) => console.error(message));

  let settled = false;
  const exitOnce = (code: number) => {
    if (settled) return;
    settled = true;
    onExit(code);
  };

  const timer = setTimeout(() => {
    log('Graceful shutdown timed out; forcing exit.');
    exitOnce(1);
  }, timeoutMs);
  // Don't let the timer itself keep the event loop alive.
  if (typeof timer.unref === 'function') timer.unref();

  try {
    await closeServer();
    await drainPool();
    exitOnce(0);
  } catch (error) {
    log(`Error during graceful shutdown: ${String(error)}`);
    exitOnce(1);
  } finally {
    clearTimeout(timer);
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

/** Wire SIGTERM/SIGINT to a one-shot graceful shutdown of the given HTTP server. */
export function registerGracefulShutdown(server: Server, timeoutMs?: number): void {
  let started = false;
  const handler = (signal: NodeJS.Signals) => {
    if (started) return;
    started = true;
    console.error(`Received ${signal}; shutting down gracefully...`);
    void runGracefulShutdown({
      closeServer: () => closeServer(server),
      closePool,
      onExit: (code) => process.exit(code),
      timeoutMs,
    });
  };
  process.once('SIGTERM', handler);
  process.once('SIGINT', handler);
}
