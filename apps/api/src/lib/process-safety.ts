interface Logger {
  error: (...args: unknown[]) => void;
}

type ExitProcess = (code: number) => never | void;

/**
 * Last-resort net: log an unhandled promise rejection, then terminate the process. Request
 * handlers should be wrapped with `asyncHandler` so rejections become `next(err)`; this catches
 * anything that still slips through (a stray background promise or a future un-wrapped handler)
 * without continuing to serve from potentially unhealthy shared state.
 *
 * Registered once from `server.ts`. Not called for `uncaughtException` on purpose — after an
 * uncaught synchronous throw the process state may be corrupt, so we let that crash.
 */
export function registerProcessSafetyNet(
  logger: Logger = console,
  exitProcess: ExitProcess = process.exit,
): void {
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection; terminating process:', reason);
    exitProcess(1);
  });
}
