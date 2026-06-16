import { Router } from 'express';
import { requireUser } from '@/lib/auth';
import {
  createSavedSearch as createSavedSearchStore,
  deleteSavedSearch as deleteSavedSearchStore,
  listSavedSearches as listSavedSearchesStore,
} from '@/data/saved-search-store';
import type { CreateSavedSearchBody } from '@/types';

export interface SavedSearchDeps {
  listSavedSearches: typeof listSavedSearchesStore;
  createSavedSearch: typeof createSavedSearchStore;
  deleteSavedSearch: typeof deleteSavedSearchStore;
}

const defaultDeps: SavedSearchDeps = {
  listSavedSearches: listSavedSearchesStore,
  createSavedSearch: createSavedSearchStore,
  deleteSavedSearch: deleteSavedSearchStore,
};

export function createSavedSearchesRouter(deps: SavedSearchDeps = defaultDeps) {
  const router = Router();

  router.get('/', async (request, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) return;
    try {
      response.json({ savedSearches: await deps.listSavedSearches(userId) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (request, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) return;

    const body = request.body as Partial<CreateSavedSearchBody>;
    const query = body.query?.trim();
    if (!query) {
      response.status(400).json({ error: 'Invalid saved search', fields: { query: 'A search query is required.' } });
      return;
    }

    try {
      const saved = await deps.createSavedSearch(userId, {
        query,
        location: body.location?.trim() || undefined,
        remoteOnly: Boolean(body.remoteOnly),
      });
      response.status(201).json({ savedSearch: saved });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:id', async (request, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) return;
    try {
      const removed = await deps.deleteSavedSearch(userId, request.params.id);
      if (!removed) {
        response.status(404).json({ error: 'Saved search not found' });
        return;
      }
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const savedSearchesRouter = createSavedSearchesRouter();
