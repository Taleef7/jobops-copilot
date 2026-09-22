import { Router } from 'express';
import { requireUser } from '@/lib/auth';
import { createExtToken, listExtTokens, revokeExtToken } from '@/data/ext-token-store';
import type { ExtTokenRecord } from '@/types';

export type PublicExtTokenRecord = Omit<ExtTokenRecord, 'tokenHash'>;

export const extTokensRouter = Router();

extTokensRouter.get('/', async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const records = await listExtTokens(userId);
  const tokens: PublicExtTokenRecord[] = records.map((record) => ({
    id: record.id,
    userId: record.userId,
    label: record.label,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
  }));
  response.json({ tokens });
});

extTokensRouter.post('/', async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const label =
    typeof request.body?.label === 'string' && request.body.label.trim()
      ? request.body.label.trim()
      : 'Chrome Extension';

  const { token, record } = await createExtToken(userId, label);
  const publicRecord: PublicExtTokenRecord = {
    id: record.id,
    userId: record.userId,
    label: record.label,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
  };

  response.status(201).json({
    token: publicRecord,
    rawToken: token,
  });
});

extTokensRouter.delete('/:id', async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const id = request.params.id;
  if (!id) {
    response.status(400).json({ error: 'Missing token ID' });
    return;
  }

  const success = await revokeExtToken(userId, id);
  if (!success) {
    response.status(404).json({ error: 'Token not found or already revoked' });
    return;
  }

  response.json({ success: true });
});
