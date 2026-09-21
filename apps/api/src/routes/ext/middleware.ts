import type { NextFunction, Request, Response } from 'express';
import { verifyAndTouchExtToken } from '@/data/ext-token-store';
import { createRateLimiter } from '@/lib/rate-limit';
import type { ExtTokenRecord } from '@/types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      extToken?: ExtTokenRecord;
    }
  }
}

const extMax = Number(process.env.RATE_LIMIT_EXT_MAX ?? 120);

/**
 * Rate limiter specifically for Chrome Extension endpoints (/api/ext/*).
 * Defaults to 120 requests/minute per user.
 */
export const extLimiter = createRateLimiter(extMax, 'ext');

/**
 * Authentication middleware for Chrome Extension endpoints (/api/ext/*).
 * Requires Authorization: Bearer jop_<hex> header.
 * Validates sha256 hash against ext_tokens table, rejects revoked tokens,
 * touches last_used_at, and sets request.userId to the token owner.
 */
export async function requireExtToken(request: Request, response: Response, next: NextFunction): Promise<void> {
  const authHeader = request.header('Authorization')?.trim();
  if (!authHeader) {
    response.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const parts = authHeader.split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') {
    response.status(401).json({ error: 'Invalid Authorization header format. Expected "Bearer <token>"' });
    return;
  }

  const rawToken = parts[1];
  if (!rawToken || !rawToken.startsWith('jop_')) {
    response.status(401).json({ error: 'Invalid personal access token format' });
    return;
  }

  try {
    const record = await verifyAndTouchExtToken(rawToken);
    if (!record) {
      response.status(401).json({ error: 'Invalid or revoked personal access token' });
      return;
    }

    request.userId = record.userId;
    request.extToken = record;
    next();
  } catch (error) {
    console.error('Error verifying extension token:', error);
    response.status(500).json({ error: 'Failed to authenticate extension token' });
  }
}
