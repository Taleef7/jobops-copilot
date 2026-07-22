import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wrap an async Express handler so a rejected promise is forwarded to the error
 * middleware via `next(err)` instead of becoming an unhandled rejection.
 *
 * Express 4 does not await route handlers, so an `await` that rejects outside a
 * try/catch escapes the handler entirely; under Node's default that terminates
 * the process and drops every in-flight request. This wrapper closes that class
 * of bug for any handler it is applied to.
 */
export function asyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (request, response, next) => {
    handler(request, response, next).catch(next);
  };
}
