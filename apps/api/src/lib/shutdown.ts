import type { Server } from 'node:http';
import { flushAppInsights } from '@/lib/app-insights';
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
  /** Best-effort flush of buffered telemetry before exit. */
  flushTelemetry?: () => Promise<void>;
  /** Force-exit budget if draining hangs (default 10s). */
  timeoutMs?: number;
  log?: (message: string) => void;
}

/** Orchestrate the drain → flush → close-pool → exit sequence. Pure of process/signal wiring. */
export async function runGracefulShutdown(deps: ShutdownDeps): Promise<void> {
  const { closeServer, closePool: drainPool, onExit, flushTelemetry, timeoutMs = 10_000 } = deps;
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
    // Flush telemetry (best-effort) and drain the pool AFTER in-flight requests finish,
    // since those requests may still issue DB queries.
    if (flushTelemetry) await flushTelemetry();
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
    // A signal can arrive before the socket is listening (listen() is async); that's a
    // clean early shutdown, not a failure.
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (error && code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolve();
    });
    // Free idle keep-alive sockets so a deploy with no in-flight request drains in
    // milliseconds and exits 0, instead of always falling through to the force-exit timeout.
    server.closeIdleConnections();
  });
}

/** Wire SIGTERM/SIGINT to a one-shot graceful shutdown of the given HTTP server. */
export function registerGracefulShutdown(server: Server, timeoutMs?: number): void {
  let started = false;
  const handler = (signal: NodeJS.Signals) => {
    // process.once dedups a repeat of the SAME signal; `started` dedups across DIFFERENT
    // signals (e.g. SIGTERM then SIGINT) since both register this same closure.
    if (started) return;
    started = true;
    console.error(`Received ${signal}; shutting down gracefully...`);
    void runGracefulShutdown({
      closeServer: () => closeServer(server),
      closePool,
      onExit: (code) => process.exit(code),
      flushTelemetry: flushAppInsights,
      timeoutMs,
    });
  };
  process.once('SIGTERM', handler);
  process.once('SIGINT', handler);
}
