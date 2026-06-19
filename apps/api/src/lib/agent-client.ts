/**
 * Client for the Python AI agent service (services/agent).
 *
 * When AGENT_SERVICE_URL is set, analysis is delegated to the real-LLM agent
 * service. On any failure (unset URL, network error, non-2xx, invalid payload),
 * we transparently fall back to the deterministic mock in analysis-core /
 * mock-store. This preserves the project's offline/demo resilience: the app
 * always returns a valid, validated result.
 */

import {
  parseJobDescription,
  scoreJobFit,
  validateFitScoreOutput,
  validateParsedJobOutput,
  type FitScoreOutput,
  type ParsedJobOutput,
} from '@/lib/analysis-core';
import { draftOutreachBody } from '@/data/mock-store';
import type { ActivityPoint, TelemetryInsights } from '@/lib/telemetry';
import type { DraftOutreachBody } from '@/types';

const AGENT_URL = process.env.AGENT_SERVICE_URL?.trim().replace(/\/$/, '');
const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 60_000);
// Tool-using agents (Phase 8) can take longer than the single-shot chains.
const AGENT_TASK_TIMEOUT_MS = Number(process.env.AGENT_TASK_TIMEOUT_MS ?? 120_000);

/**
 * Build request headers for an agent call, attaching the server-to-server shared
 * secret (QA·A) when AGENT_API_KEY is configured. The agent is reached over its
 * public FQDN, so this Bearer token is what authenticates the API→agent hop.
 * Read lazily (not at module load) so the env reflects the current process state.
 */
export function agentHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const key = process.env.AGENT_API_KEY?.trim();
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

/** Thrown when an agent task is requested but the service is not configured. */
export class AgentDisabledError extends Error {
  constructor() {
    super('The AI agent service is not configured.');
    this.name = 'AgentDisabledError';
  }
}

export function isAgentEnabled(): boolean {
  return Boolean(AGENT_URL);
}

async function callAgent<T>(path: string, payload: unknown, timeoutMs = AGENT_TIMEOUT_MS): Promise<T> {
  const response = await fetch(`${AGENT_URL}${path}`, {
    method: 'POST',
    headers: agentHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`agent ${path} responded with ${response.status}`);
  }

  return (await response.json()) as T;
}

/**
 * A timeout/abort error from `AbortSignal.timeout` — the signature of the agent
 * Container App cold-starting (scale-to-zero) rather than being genuinely down. The
 * first request wakes the container; by the time it times out the container is usually
 * warming, so a single retry tends to land a real result instead of a mock (QA·B).
 * Connection-refused / other errors (TypeError) are NOT cold starts and skip the retry.
 */
export function isColdStartError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/** Run an agent op, retrying once if the first attempt times out on a cold start (QA·B). */
export async function withColdStartRetry<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    if (isColdStartError(error)) {
      console.warn('agent call timed out (cold start?); retrying once before mock fallback');
      return op();
    }
    throw error;
  }
}

/**
 * Run a Phase 8 agent task (interview-prep, research, skill-gap). Unlike the
 * analysis resolvers, these have no mock fallback — they are net-new
 * capabilities — so this throws AgentDisabledError when the service is unset.
 */
export async function runAgentTask<T>(path: string, payload: unknown): Promise<T> {
  if (!isAgentEnabled()) {
    throw new AgentDisabledError();
  }
  return callAgent<T>(path, payload, AGENT_TASK_TIMEOUT_MS);
}

export interface AssistantRunInput {
  descriptionText: string;
  resumeText?: string;
  profileText?: string;
  userId?: string;
}

/** Start an application-assistant run (LangGraph). Net-new — no mock fallback. */
export async function runAssistant(input: AssistantRunInput): Promise<unknown> {
  if (!isAgentEnabled()) {
    throw new AgentDisabledError();
  }
  return callAgent(
    '/assistant/run',
    {
      description_text: input.descriptionText,
      resume_text: input.resumeText,
      profile_text: input.profileText,
      user_id: input.userId,
    },
    AGENT_TASK_TIMEOUT_MS,
  );
}

/** Resume a paused assistant run with the human approval decision. */
export async function resumeAssistant(threadId: string, approved: boolean): Promise<unknown> {
  if (!isAgentEnabled()) {
    throw new AgentDisabledError();
  }
  return callAgent('/assistant/resume', { thread_id: threadId, approved }, AGENT_TASK_TIMEOUT_MS);
}

/** Open the agent's SSE assistant stream; returns the raw upstream Response to pipe. */
export async function streamAssistantUpstream(payload: unknown): Promise<Response> {
  if (!isAgentEnabled()) {
    throw new AgentDisabledError();
  }
  return fetch(`${AGENT_URL}/assistant/stream`, {
    method: 'POST',
    headers: agentHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(AGENT_TASK_TIMEOUT_MS),
  });
}

/** Analyze the activity series via the agent (pandas + LLM narration). */
export async function analyzeTelemetryViaAgent(series: ActivityPoint[]): Promise<TelemetryInsights> {
  return callAgent<TelemetryInsights>('/telemetry/insights', { series }, AGENT_TASK_TIMEOUT_MS);
}

/** Fetch the synthetic EV battery telemetry demo from the agent (GET). */
export async function fetchEvDemoViaAgent(): Promise<TelemetryInsights> {
  if (!isAgentEnabled()) {
    throw new AgentDisabledError();
  }
  const response = await fetch(`${AGENT_URL}/telemetry/ev-demo`, {
    headers: agentHeaders(),
    signal: AbortSignal.timeout(AGENT_TASK_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`agent /telemetry/ev-demo responded with ${response.status}`);
  }
  return (await response.json()) as TelemetryInsights;
}

export interface ScoreFitInput {
  userId?: string;
  descriptionText: string;
  resumeText: string;
  profileText: string;
  requiredSkills?: string[];
  preferredSkills?: string[];
  atsKeywords?: string[];
  retrievedContext?: string[];
}

export interface OutreachDraftResult {
  subject: string;
  draft_text: string;
  safety_notes?: string;
}

/** Parse a job description via the agent, falling back to the mock parser. */
export async function resolveParsedJob(descriptionText: string): Promise<ParsedJobOutput> {
  if (isAgentEnabled()) {
    try {
      const parsed = await withColdStartRetry(() =>
        callAgent<ParsedJobOutput>('/parse-job', {
          description_text: descriptionText,
        }),
      );
      if (validateParsedJobOutput(parsed)) {
        return parsed;
      }
      console.warn('agent /parse-job returned an invalid payload; falling back to mock');
    } catch (error) {
      console.warn('agent /parse-job failed; falling back to mock', error);
    }
  }
  return parseJobDescription(descriptionText);
}

/** Score job fit via the agent, falling back to the mock scorer. */
export async function resolveFitScore(input: ScoreFitInput): Promise<FitScoreOutput> {
  if (isAgentEnabled()) {
    try {
      const scored = await withColdStartRetry(() =>
        callAgent<FitScoreOutput>('/score-fit', {
          user_id: input.userId,
          description_text: input.descriptionText,
          resume_text: input.resumeText,
          profile_text: input.profileText,
          required_skills: input.requiredSkills,
          preferred_skills: input.preferredSkills,
          ats_keywords: input.atsKeywords,
          retrieved_context: input.retrievedContext,
        }),
      );
      if (validateFitScoreOutput(scored)) {
        return scored;
      }
      console.warn('agent /score-fit returned an invalid payload; falling back to mock');
    } catch (error) {
      console.warn('agent /score-fit failed; falling back to mock', error);
    }
  }
  return scoreJobFit(input);
}

/** Draft outreach via the agent, falling back to the mock drafter. */
export async function resolveOutreachDraft(
  payload: DraftOutreachBody & { company?: string; retrieved_context?: string[] },
): Promise<OutreachDraftResult> {
  if (isAgentEnabled()) {
    try {
      const draft = await callAgent<OutreachDraftResult>('/draft-outreach', {
        message_type: payload.message_type,
        contact_name: payload.contact_name,
        contact_role: payload.contact_role,
        company: payload.company,
        job_context: payload.job_context,
        resume_summary: payload.resume_summary,
        retrieved_context: payload.retrieved_context,
      });
      if (draft && typeof draft.draft_text === 'string' && draft.draft_text.trim()) {
        return draft;
      }
      console.warn('agent /draft-outreach returned an invalid payload; falling back to mock');
    } catch (error) {
      console.warn('agent /draft-outreach failed; falling back to mock', error);
    }
  }
  return draftOutreachBody(payload);
}
