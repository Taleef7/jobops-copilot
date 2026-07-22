interface Logger {
  error: (...args: unknown[]) => void;
}

/**
 * Last-resort net: log an unhandled promise rejection instead of letting Node's default
 * behavior crash the process. Request handlers should be wrapped with `asyncHandler` so
 * rejections become `next(err)`; this catches anything that still slips through (a stray
 * background promise, a future un-wrapped handler) so a single miss can't take the API down.
 *
 * Registered once from `server.ts`. Not called for `uncaughtException` on purpose — after an
 * uncaught synchronous throw the process state may be corrupt, so we let that crash.
 */
export function registerProcessSafetyNet(logger: Logger = console): void {
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection (process kept alive):', reason);
  });
}
