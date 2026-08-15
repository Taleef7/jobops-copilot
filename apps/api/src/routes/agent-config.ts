import { Router } from 'express';
import { requireAdmin, requireUser } from '@/lib/auth';
import { hasPostgresConnection } from '@/lib/postgres';
import {
  activateAgentConfigVersion,
  insertAgentConfigVersion,
  isAgentId,
  listAgentConfigs,
} from '@/data/agent-config-store';
import type { AgentConfigRecord, AgentId } from '@/data/agent-config-store';

export interface AgentConfigDeps {
  hasDb: () => boolean;
  listConfigs: (agentId: AgentId) => Promise<AgentConfigRecord[]>;
  activateVersion: (agentId: AgentId, version: number) => Promise<boolean>;
  insertVersion: (
    agentId: AgentId,
    model: string,
    params: Record<string, unknown>,
    promptOverrides: Record<string, unknown>,
  ) => Promise<number>;
}

const defaultDeps: AgentConfigDeps = {
  hasDb: hasPostgresConnection,
  listConfigs: listAgentConfigs,
  activateVersion: activateAgentConfigVersion,
  insertVersion: insertAgentConfigVersion,
};

/** `provider:model-id` — neither half may be empty or padded with whitespace. */
const MODEL_PATTERN = /^\S+:\S+$/;

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * `GET /api/agents/:agentId/config` — the active config plus every stored version.
 * `PUT /api/agents/:agentId/config` — `{ version }` repoints active to an existing version;
 * `{ model, params?, promptOverrides? }` inserts the next version and activates it.
 */
export function createAgentConfigRouter(deps: AgentConfigDeps = defaultDeps) {
  const router = Router({ mergeParams: true });

  /** Resolves the route's agent id, or writes the failing response and returns null. */
  function resolveAgent(agentId: string, response: import('express').Response): AgentId | null {
    if (!isAgentId(agentId)) {
      response.status(404).json({ error: `Unknown agent: ${agentId}` });
      return null;
    }
    if (!deps.hasDb()) {
      response.status(503).json({ error: 'Agent configs require a database (DATABASE_URL).' });
      return null;
    }
    return agentId;
  }

  router.get('/:agentId/config', async (request, response, next) => {
    if (!requireUser(request, response)) return;
    const agentId = resolveAgent(request.params.agentId ?? '', response);
    if (!agentId) return;

    try {
      const versions = await deps.listConfigs(agentId);
      response.json({ active: versions.find((config) => config.active) ?? null, versions });
    } catch (error) {
      next(error);
    }
  });

  // Writes are operator-only: `agent_configs` is global (keyed by agent id, not user), so an
  // ordinary signed-in user must not be able to repoint the model every tenant's agents run on.
  router.put('/:agentId/config', async (request, response, next) => {
    if (!requireAdmin(request, response)) return;
    const agentId = resolveAgent(request.params.agentId ?? '', response);
    if (!agentId) return;

    const body = (request.body ?? {}) as {
      version?: unknown;
      model?: unknown;
      params?: unknown;
      promptOverrides?: unknown;
    };

    try {
      if (body.version !== undefined) {
        if (typeof body.version !== 'number' || !Number.isInteger(body.version)) {
          response.status(400).json({ error: '`version` must be an integer.' });
          return;
        }
        if (!(await deps.activateVersion(agentId, body.version))) {
          response.status(404).json({ error: `No version ${body.version} for ${agentId}` });
          return;
        }
        response.json({ ok: true, activeVersion: body.version });
        return;
      }

      if (body.model !== undefined) {
        // A model is a LangChain `init_chat_model` string, so both halves must be present and
        // non-empty: a bare model id would resolve against whichever provider happened to be
        // default, and an empty half ('anthropic:', ':haiku') resolves to nothing at all —
        // activating one would silently disable every run of that agent until a rollback.
        if (typeof body.model !== 'string' || !MODEL_PATTERN.test(body.model)) {
          response.status(400).json({ error: '`model` must be a "provider:model-id" string.' });
          return;
        }
        const params = asObject(body.params);
        const promptOverrides = asObject(body.promptOverrides);
        if (!params || !promptOverrides) {
          response.status(400).json({ error: '`params` and `promptOverrides` must be objects.' });
          return;
        }
        const version = await deps.insertVersion(agentId, body.model, params, promptOverrides);
        response.status(201).json({ ok: true, activeVersion: version });
        return;
      }

      response
        .status(400)
        .json({ error: 'Body must be { version } or { model, params?, promptOverrides? }.' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const agentConfigRouter = createAgentConfigRouter();
