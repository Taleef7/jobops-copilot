// Adds the per-request user id resolved by the auth middleware (src/lib/auth.ts).
import 'express';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export {};
