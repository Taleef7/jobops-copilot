import { Router } from 'express';
import { requireUser } from '@/lib/auth';
import { getJobById } from '@/data/job-store';
import { listAgentOutputs } from '@/data/agent-output-store';

export interface AgentOutputsDeps {
  getJob: typeof getJobById;
  listAgentOutputs: typeof listAgentOutputs;
}

const defaultDeps: AgentOutputsDeps = { getJob: getJobById, listAgentOutputs };

/** `GET /api/jobs/:id/agent-outputs` — the persisted agent outputs for a job. */
export function createAgentOutputsRouter(deps: AgentOutputsDeps = defaultDeps) {
  const router = Router();

  router.get('/:id/agent-outputs', async (request, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) return;

    try {
      const job = await deps.getJob(userId, request.params.id);
      if (!job) {
        response.status(404).json({ error: 'Job not found' });
        return;
      }
      response.json({ outputs: await deps.listAgentOutputs(userId, request.params.id) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const agentOutputsRouter = createAgentOutputsRouter();
