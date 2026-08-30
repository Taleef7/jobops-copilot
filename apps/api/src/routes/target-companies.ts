import { Router } from 'express';
import { requireUser } from '@/lib/auth';
import {
  createTargetCompany as createTargetCompanyStore,
  deleteTargetCompany as deleteTargetCompanyStore,
  listTargetCompanies as listTargetCompaniesStore,
  setTargetCompanyEnabled as setTargetCompanyEnabledStore,
} from '@/data/target-company-store';
import type { CreateTargetCompanyBody } from '@/types';

const VALID_BOARD_TYPES = new Set(['greenhouse', 'lever', 'ashby']);
/** Only URL-safe slug characters — reject path traversal and shell metacharacters. */
const BOARD_TOKEN_RE = /^[A-Za-z0-9._-]+$/;

export interface TargetCompanyDeps {
  listTargetCompanies: typeof listTargetCompaniesStore;
  createTargetCompany: typeof createTargetCompanyStore;
  setTargetCompanyEnabled: typeof setTargetCompanyEnabledStore;
  deleteTargetCompany: typeof deleteTargetCompanyStore;
}

const defaultDeps: TargetCompanyDeps = {
  listTargetCompanies: listTargetCompaniesStore,
  createTargetCompany: createTargetCompanyStore,
  setTargetCompanyEnabled: setTargetCompanyEnabledStore,
  deleteTargetCompany: deleteTargetCompanyStore,
};

export function createTargetCompaniesRouter(deps: TargetCompanyDeps = defaultDeps) {
  const router = Router();

  router.get('/', async (request, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) return;
    try {
      response.json({ targetCompanies: await deps.listTargetCompanies(userId) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (request, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) return;

    const body = request.body as Partial<CreateTargetCompanyBody>;
    const company = body.company?.trim();
    if (!company) {
      response.status(400).json({ error: 'Invalid target company', fields: { company: 'A company name is required.' } });
      return;
    }

    const boardType = body.boardType;
    if (!boardType || !VALID_BOARD_TYPES.has(boardType)) {
      response.status(400).json({
        error: 'Invalid target company',
        fields: { boardType: 'boardType must be one of: greenhouse, lever, ashby.' },
      });
      return;
    }

    const boardToken = body.boardToken?.trim();
    if (!boardToken || !BOARD_TOKEN_RE.test(boardToken)) {
      response.status(400).json({
        error: 'Invalid target company',
        fields: { boardToken: 'boardToken must be a non-empty slug containing only letters, digits, dots, underscores, or hyphens.' },
      });
      return;
    }

    try {
      const created = await deps.createTargetCompany(userId, { company, boardType, boardToken });
      response.status(201).json({ targetCompany: created });
    } catch (error) {
      // Postgres unique-constraint violation: (user_id, board_type, board_token) already exists
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === '23505'
      ) {
        response.status(409).json({ error: 'This board is already tracked.' });
        return;
      }
      // File-store duplicate detection
      if (
        error instanceof Error &&
        error.message === 'This board is already tracked.'
      ) {
        response.status(409).json({ error: 'This board is already tracked.' });
        return;
      }
      next(error);
    }
  });

  router.patch('/:id', async (request, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) return;

    const body = request.body as { enabled?: boolean };
    const enabled = Boolean(body.enabled);

    try {
      const updated = await deps.setTargetCompanyEnabled(userId, request.params.id, enabled);
      if (!updated) {
        response.status(404).json({ error: 'Target company not found' });
        return;
      }
      response.json({ targetCompany: updated });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:id', async (request, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) return;
    try {
      const removed = await deps.deleteTargetCompany(userId, request.params.id);
      if (!removed) {
        response.status(404).json({ error: 'Target company not found' });
        return;
      }
      response.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const targetCompaniesRouter = createTargetCompaniesRouter();
