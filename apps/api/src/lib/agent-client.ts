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
import type {
  DraftOutreachBody,
  ResumeBasics,
  ResumeCertificate,
  ResumeEducation,
  ResumeProject,
  ResumeSkill,
  ResumeWorkExperience,
  StructuredResume,
} from '@/types';

const AGENT_URL = process.env.AGENT_SERVICE_URL?.trim().replace(/\/$/, '');
const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 60_000);
// Tool-using agents (Phase 8) can take longer than the single-shot chains.
const AGENT_TASK_TIMEOUT_MS = Number(process.env.AGENT_TASK_TIMEOUT_MS ?? 120_000);
// How long a wake-up ping waits. It only has to reach the container, not get an answer.
const AGENT_WAKE_TIMEOUT_MS = 3_000;

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

function agentServiceUrl(): string | undefined {
  return process.env.AGENT_SERVICE_URL?.trim().replace(/\/$/, '') || AGENT_URL;
}

export function isAgentEnabled(): boolean {
  return Boolean(agentServiceUrl());
}

async function callAgent<T>(path: string, payload: unknown, timeoutMs = AGENT_TIMEOUT_MS): Promise<T> {
  const baseUrl = agentServiceUrl();
  if (!baseUrl) throw new AgentDisabledError();
  const response = await fetch(`${baseUrl}${path}`, {
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
 * A timeout/abort error from `AbortSignal.timeout`: usually the agent Container App
 * cold-starting (scale-to-zero) rather than being down. Connection-refused and other
 * errors (TypeError) are not cold starts.
 */
export function isColdStartError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/** A free GET /health that wakes a scale-to-zero agent. Never throws. */
async function wakeAgent(): Promise<void> {
  const baseUrl = agentServiceUrl();
  if (!baseUrl) return;
  await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(AGENT_WAKE_TIMEOUT_MS) })
    .then((response) => response.body?.cancel())
    .catch(() => undefined);
}

/**
 * Run a paid agent call once. On a timeout, wake the agent with /health and fail: the
 * agent keeps working (and billing) after the client gives up, so re-sending the call
 * would pay for it twice, and a human-in-the-loop resume isn't safe to repeat (#345).
 */
export async function withColdStartWake<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    if (isColdStartError(error)) {
      console.warn('agent call timed out (cold start?); woke the agent with /health, not retrying the paid call');
      await wakeAgent();
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
  return withColdStartWake(() =>
    fetch(`${agentServiceUrl()}/assistant/stream`, {
      method: 'POST',
      headers: agentHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(AGENT_TASK_TIMEOUT_MS),
    }),
  );
}

/** Open the conversational chat token stream on the agent service (Phase 5). */
export async function streamAssistantChatUpstream(payload: unknown): Promise<Response> {
  if (!isAgentEnabled()) {
    throw new AgentDisabledError();
  }
  return withColdStartWake(() =>
    fetch(`${agentServiceUrl()}/assistant/chat`, {
      method: 'POST',
      headers: agentHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(AGENT_TASK_TIMEOUT_MS),
    }),
  );
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
  const response = await fetch(`${agentServiceUrl()}/telemetry/ev-demo`, {
    headers: agentHeaders(),
    signal: AbortSignal.timeout(AGENT_TASK_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`agent /telemetry/ev-demo responded with ${response.status}`);
  }
  return (await response.json()) as TelemetryInsights;
}

/** Open a generic specialist-agent stream and return the raw response for piping. */
export async function streamAgentUpstream(agentId: string, payload: unknown): Promise<Response> {
  if (!isAgentEnabled()) throw new AgentDisabledError();
  const encodedId = encodeURIComponent(agentId);
  return withColdStartWake(() =>
    fetch(`${agentServiceUrl()}/agents/${encodedId}/stream`, {
      method: 'POST',
      headers: agentHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(AGENT_TASK_TIMEOUT_MS),
    }),
  );
}

/** Resume a generic specialist-agent stream and return the raw response for piping. */
export async function resumeAgentUpstream(agentId: string, payload: unknown): Promise<Response> {
  if (!isAgentEnabled()) throw new AgentDisabledError();
  const encodedId = encodeURIComponent(agentId);
  return withColdStartWake(() =>
    fetch(`${agentServiceUrl()}/agents/${encodedId}/resume`, {
      method: 'POST',
      headers: agentHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(AGENT_TASK_TIMEOUT_MS),
    }),
  );
}

export interface ScoreFitInput {
  userId?: string;
  descriptionText: string;
  resumeText: string;
  profileText: string;
  /** Parsed role title. The agent distills its RAG query from title + skills, so
   *  dropping it makes a role with only generic parsed skills retrieve on those alone. */
  title?: string | null;
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
      const parsed = await withColdStartWake(() =>
        callAgent<ParsedJobOutput>(
          '/parse-job',
          { description_text: descriptionText },
          AGENT_TIMEOUT_MS,
        ),
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
      const scored = await withColdStartWake(() =>
        callAgent<FitScoreOutput>(
          '/score-fit',
          {
            user_id: input.userId,
            description_text: input.descriptionText,
            resume_text: input.resumeText,
            profile_text: input.profileText,
            title: input.title,
            required_skills: input.requiredSkills,
            preferred_skills: input.preferredSkills,
            ats_keywords: input.atsKeywords,
            retrieved_context: input.retrievedContext,
          },
          AGENT_TIMEOUT_MS,
        ),
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

function asString(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback;
}

function asOptionalString(val: unknown): string | undefined {
  return typeof val === 'string' ? val : undefined;
}

/**
 * Normalizes an agent-returned or schema-deserialized object into a strongly-typed StructuredResume.
 * Bridges Python Pydantic snake_case fields (e.g. start_date, end_date, study_type, postal_code, country_code)
 * to the API/web camelCase contract.
 */
export function normalizeStructuredResume(raw: unknown): StructuredResume | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const basicsRaw = obj.basics;
  if (!basicsRaw || typeof basicsRaw !== 'object') return null;
  const basicsObj = basicsRaw as Record<string, unknown>;
  if (typeof basicsObj.name !== 'string' || !basicsObj.name.trim()) {
    return null;
  }

  const locRaw = basicsObj.location;
  const locObj =
    locRaw && typeof locRaw === 'object' ? (locRaw as Record<string, unknown>) : undefined;
  const location = locObj
    ? {
        address: asOptionalString(locObj.address),
        postalCode: asOptionalString(locObj.postalCode ?? locObj.postal_code),
        city: asOptionalString(locObj.city),
        countryCode: asOptionalString(locObj.countryCode ?? locObj.country_code),
        region: asOptionalString(locObj.region),
      }
    : undefined;

  const profiles = Array.isArray(basicsObj.profiles)
    ? basicsObj.profiles
        .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === 'object'))
        .map((p) => ({
          network: asString(p.network),
          username: asOptionalString(p.username),
          url: asString(p.url),
        }))
    : [];

  const basics: ResumeBasics = {
    name: basicsObj.name,
    label: asOptionalString(basicsObj.label),
    email: asString(basicsObj.email),
    phone: asOptionalString(basicsObj.phone),
    url: asOptionalString(basicsObj.url),
    summary: asString(basicsObj.summary),
    location,
    profiles,
  };

  const work: ResumeWorkExperience[] = Array.isArray(obj.work)
    ? obj.work
        .filter((w): w is Record<string, unknown> => Boolean(w && typeof w === 'object'))
        .map((w) => ({
          id: asOptionalString(w.id),
          company: asString(w.company),
          position: asString(w.position),
          location: asOptionalString(w.location),
          startDate: asString(w.startDate ?? w.start_date),
          endDate: asOptionalString(w.endDate ?? w.end_date),
          current: Boolean(w.current),
          summary: asString(w.summary),
          highlights: Array.isArray(w.highlights) ? w.highlights.map(String) : [],
        }))
    : [];

  const education: ResumeEducation[] = Array.isArray(obj.education)
    ? obj.education
        .filter((e): e is Record<string, unknown> => Boolean(e && typeof e === 'object'))
        .map((e) => ({
          id: asOptionalString(e.id),
          institution: asString(e.institution),
          area: asOptionalString(e.area),
          studyType: asOptionalString(e.studyType ?? e.study_type),
          startDate: asOptionalString(e.startDate ?? e.start_date),
          endDate: asOptionalString(e.endDate ?? e.end_date),
          gpa: asOptionalString(e.gpa),
          highlights: Array.isArray(e.highlights) ? e.highlights.map(String) : [],
        }))
    : [];

  const skills: ResumeSkill[] = Array.isArray(obj.skills)
    ? obj.skills
        .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
        .map((s) => ({
          category: asString(s.category, 'General'),
          skills: Array.isArray(s.skills) ? s.skills.map(String) : [],
        }))
    : [];

  const projects: ResumeProject[] | undefined = Array.isArray(obj.projects)
    ? obj.projects
        .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === 'object'))
        .map((p) => ({
          id: asOptionalString(p.id),
          name: asString(p.name),
          description: asOptionalString(p.description),
          highlights: Array.isArray(p.highlights) ? p.highlights.map(String) : [],
          keywords: Array.isArray(p.keywords) ? p.keywords.map(String) : [],
          url: asOptionalString(p.url),
        }))
    : undefined;

  const certificates: ResumeCertificate[] | undefined = Array.isArray(obj.certificates)
    ? obj.certificates
        .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
        .map((c) => ({
          name: asString(c.name),
          issuer: asString(c.issuer),
          date: asOptionalString(c.date),
          url: asOptionalString(c.url),
        }))
    : undefined;

  return {
    basics,
    work,
    education,
    skills,
    ...(projects ? { projects } : {}),
    ...(certificates ? { certificates } : {}),
  };
}

/** Parse resume text into a StructuredResume via the agent, with deterministic mock fallback. */
export async function resolveResumeParse(resumeText: string): Promise<StructuredResume> {
  if (isAgentEnabled()) {
    try {
      const parsed = await withColdStartWake(() =>
        callAgent<unknown>(
          '/parse-resume',
          { resume_text: resumeText },
          AGENT_TIMEOUT_MS,
        ),
      );
      const normalized = normalizeStructuredResume(parsed);
      if (normalized) {
        return normalized;
      }
      console.warn('agent /parse-resume returned an invalid payload; falling back to mock');
    } catch (error) {
      console.warn('agent /parse-resume failed; falling back to mock', error);
    }
  }
  return mockParseResume(resumeText);
}

/**
 * Deterministic mock resume parser for offline/demo/test mode.
 * Extracts basic structure from the raw text with simple heuristics.
 */
function mockParseResume(resumeText: string): StructuredResume {
  // Best-effort extraction: pull lines, look for a name-like first line, email, etc.
  const lines = resumeText.split('\n').map((l) => l.trim()).filter(Boolean);
  const emailMatch = resumeText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const phoneMatch = resumeText.match(/\+?[\d\s().-]{7,}/);

  return {
    basics: {
      name: lines[0] ?? 'Unknown',
      email: emailMatch?.[0] ?? 'unknown@example.com',
      phone: phoneMatch?.[0]?.trim(),
      summary: lines.length > 2 ? lines.slice(1, 4).join(' ') : '',
    },
    work: [],
    education: [],
    skills: [{ category: 'General', skills: ['(Resume parsed in offline mode — edit to add real skills)'] }],
  };
}

