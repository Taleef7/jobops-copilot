import { Router } from 'express';
import { extLimiter, requireExtToken } from './middleware';

export const extRouter = Router();

// Apply rate limiting and PAT auth to all /api/ext routes
extRouter.use(requireExtToken);
extRouter.use(extLimiter);

/**
 * Health/verification endpoint for the Chrome extension options page.
 * Returns the authenticated user's ID and token metadata when the PAT is valid.
 */
extRouter.get('/verify', (request, response) => {
  response.json({
    ok: true,
    userId: request.userId,
    token: request.extToken
      ? {
          id: request.extToken.id,
          label: request.extToken.label,
          createdAt: request.extToken.createdAt,
          lastUsedAt: request.extToken.lastUsedAt,
        }
      : undefined,
  });
});
