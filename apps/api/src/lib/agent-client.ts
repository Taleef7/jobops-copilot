/**
 * Client for the Python AI agent service (services/agent).
 *
 * Every AI result comes from the agent. When it can't give one (not configured,
 * unreachable, too slow, an error, or an answer the app can't use), the call throws
 * `AiUnavailableError`, which the API answers with 503 and `retryable: true` (#349).
 * There is no fallback: a keyword-based fake used to be returned and saved as if it
 * were the AI's answer.
 */

import {
  validateFitScoreOutput,
  normalizeWorkplace,
  validateParsedJobOutput,
  type FitScoreOutput,
  type ParsedJobOutput,
} from '@/lib/analysis-core';
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
import { AiBudgetExceededError, beforeAgentCall } from '@/lib/ai-call-context';
import { capAgentPayload } from '@/lib/input-caps';
import { normalizeLayout } from '@/lib/resume-layout';
import { isTailorAnswer, type TailorAgentRequest, type TailorAnswer } from '@/lib/tailor/answer';

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

/**
 * The AI couldn't answer this time. The message is shown to the user as is; the API
 * answers 503 with `retryable: true`, and nothing is saved (#349).
 */
export class AiUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AiUnavailableError';
  }
}

/**
 * The agent refused to read the input: it looked like instructions to the AI (#355). Not a
 * failure to retry: the API answers 422 with the reason.
 */
export class AiRefusedInputError extends Error {
  constructor(message = 'This posting has text that reads like instructions to the AI, so it wasn’t read. Enter the details yourself.') {
    super(message);
    this.name = 'AiRefusedInputError';
  }
}

/** Thrown when an agent call is requested but the service is not configured. */
export class AgentDisabledError extends AiUnavailableError {
  constructor() {
    super('The AI service is not set up on this server.');
    this.name = 'AgentDisabledError';
  }
}

const UNUSABLE_ANSWER = "The AI's answer couldn't be used. Try again.";

/** The agent answered with an error status (or a stream with nothing in it). */
export const AI_NO_ANSWER = "The AI couldn't answer this time. Try again in a moment.";

/** Any failure of an agent call, as the error the user sees. The budget error passes through. */
function asAiUnavailable(error: unknown, path: string): unknown {
  if (error instanceof AiBudgetExceededError || error instanceof AiUnavailableError) return error;
  console.warn(`agent ${path} failed`, error);
  if (isColdStartError(error)) {
    return new AiUnavailableError('The AI took too long to answer. Try again in a moment.', { cause: error });
  }
  return new AiUnavailableError("The AI couldn't be reached. Try again in a moment.", { cause: error });
}

function agentServiceUrl(): string | undefined {
  return process.env.AGENT_SERVICE_URL?.trim().replace(/\/$/, '') || AGENT_URL;
}

export function isAgentEnabled(): boolean {
  return Boolean(agentServiceUrl());
}

/**
 * POST a paid request to the agent, with its text cut to the LLM limits and its size-based
 * cost reserved against the daily budget first (#345).
 */
async function postToAgent(path: string, payload: unknown, timeoutMs: number): Promise<Response> {
  const capped = capAgentPayload(payload);
  if (capped.truncated) console.warn(`agent ${path}: input cut to the LLM limit`);
  const body = JSON.stringify(capped.payload);
  await beforeAgentCall(body.length, capped.truncated);
  return fetch(`${agentServiceUrl()}${path}`, {
    method: 'POST',
    headers: agentHeaders({ 'Content-Type': 'application/json' }),
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function callAgent<T>(path: string, payload: unknown, timeoutMs = AGENT_TIMEOUT_MS): Promise<T> {
  if (!agentServiceUrl()) throw new AgentDisabledError();
  let response: Response;
  try {
    response = await postToAgent(path, payload, timeoutMs);
  } catch (error) {
    throw asAiUnavailable(error, path);
  }
  if (!response.ok) {
    console.warn(`agent ${path} responded with ${response.status}`);
    // A 422 is read to tell a refusal from FastAPI's validation error; anything else is
    // dropped unread. The body is read once: cancelling it after reading throws.
    if (response.status === 422) {
      if (await refusedInput(response)) throw new AiRefusedInputError();
    } else {
      await response.body?.cancel();
    }
    throw new AiUnavailableError(AI_NO_ANSWER);
  }
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw asAiUnavailable(error, path);
  }
}

/** True when a 422 is the agent refusing the input (`detail.code: "input_refused"`). Reads the body. */
async function refusedInput(response: Response): Promise<boolean> {
  const text = await response.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { detail?: unknown } | null;
    const detail = body && typeof body === 'object' ? body.detail : undefined;
    return Boolean(detail && typeof detail === 'object' && (detail as { code?: unknown }).code === 'input_refused');
  } catch {
    return false;
  }
}

/**
 * A timeout/abort error from `AbortSignal.timeout`: usually the agent Container App
 * cold-starting (scale-to-zero) rather than being down. Connection-refused and other
 * errors (TypeError) are not cold starts.
 */
export function isColdStartError(error: unknown): boolean {
  // callAgent wraps a timeout in AiUnavailableError; the timeout is its cause.
  if (error instanceof AiUnavailableError) return isColdStartError(error.cause);
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
 * Run a Phase 8 agent task (interview-prep, research, skill-gap). Throws
 * `AiUnavailableError` (or `AgentDisabledError` when the service is unset).
 */
export async function runAgentTask<T>(path: string, payload: unknown): Promise<T> {
  if (!isAgentEnabled()) {
    throw new AgentDisabledError();
  }
  const result = await callAgent<unknown>(path, payload, AGENT_TASK_TIMEOUT_MS);
  // An answer the page can't show is not saved as a result (#349).
  const isUsable = SPECIALIST_ANSWERS[path];
  if (isUsable && !isUsable(result)) {
    console.warn(`agent ${path} returned an unusable answer`);
    throw new AiUnavailableError(UNUSABLE_ANSWER);
  }
  return result as T;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);

/** What the job page reads from each specialist's answer. */
const SPECIALIST_ANSWERS: Record<string, (value: unknown) => boolean> = {
  '/agents/interview-prep': (value) =>
    isRecord(value) &&
    isTextList(value.likely_questions) &&
    isTextList(value.talking_points) &&
    isTextList(value.gaps_to_address) &&
    isTextList(value.questions_to_ask),
  '/agents/research': (value) =>
    isRecord(value) &&
    isText(value.company_summary) &&
    isTextList(value.recent_signals) &&
    isTextList(value.talking_points) &&
    isTextList(value.questions_to_ask),
  '/agents/skill-gap': (value) =>
    isRecord(value) &&
    isText(value.summary) &&
    Array.isArray(value.prioritized_skills) &&
    value.prioritized_skills.every(
      (item) =>
        isRecord(item) &&
        isText(item.skill) &&
        isText(item.why_it_matters) &&
        (item.learning_resources === undefined || isTextList(item.learning_resources)),
    ),
};

export interface AssistantRunInput {
  descriptionText: string;
  resumeText?: string;
  profileText?: string;
  userId?: string;
}

/** Start an application-assistant run (LangGraph). */
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

/**
 * POST to a streaming agent route and return the raw response to pipe. A failure to reach
 * the agent is an AiUnavailableError (503, retryable), like every other agent call.
 */
function openAgentStream(path: string, payload: unknown): Promise<Response> {
  return withColdStartWake(async () => {
    let response: Response;
    try {
      response = await postToAgent(path, payload, AGENT_TASK_TIMEOUT_MS);
    } catch (error) {
      throw asAiUnavailable(error, path);
    }
    if (!response.ok) {
      console.warn(`agent ${path} responded with ${response.status}`);
      await response.body?.cancel();
      throw new AiUnavailableError(AI_NO_ANSWER);
    }
    return response;
  });
}

/** Open the agent's SSE assistant stream; returns the raw upstream Response to pipe. */
export async function streamAssistantUpstream(payload: unknown): Promise<Response> {
  if (!isAgentEnabled()) {
    throw new AgentDisabledError();
  }
  return openAgentStream('/assistant/stream', payload);
}

/** Open the conversational chat token stream on the agent service (Phase 5). */
export async function streamAssistantChatUpstream(payload: unknown): Promise<Response> {
  if (!isAgentEnabled()) {
    throw new AgentDisabledError();
  }
  return openAgentStream('/assistant/chat', payload);
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
  await beforeAgentCall(0);
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
  return openAgentStream(`/agents/${encodedId}/stream`, payload);
}

/** Resume a generic specialist-agent stream and return the raw response for piping. */
export async function resumeAgentUpstream(agentId: string, payload: unknown): Promise<Response> {
  if (!isAgentEnabled()) throw new AgentDisabledError();
  const encodedId = encodeURIComponent(agentId);
  return openAgentStream(`/agents/${encodedId}/resume`, payload);
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

/** Parse a job description via the agent. Throws `AiUnavailableError` when it can't. */
export async function resolveParsedJob(descriptionText: string): Promise<ParsedJobOutput> {
  const parsed = await withColdStartWake(() =>
    callAgent<ParsedJobOutput>('/parse-job', { description_text: descriptionText }, AGENT_TIMEOUT_MS),
  );
  if (!validateParsedJobOutput(parsed)) throw new AiUnavailableError(UNUSABLE_ANSWER);
  // A workplace in other words ("On-site") is read; one the app doesn't know is left out
  // (unknown). An odd word mustn't fail Score fit or the n8n intake, which parse the same way (#355).
  if ('workplace_type' in parsed) {
    const workplace = normalizeWorkplace(parsed.workplace_type);
    if (workplace === undefined) delete parsed.workplace_type;
    else parsed.workplace_type = workplace;
  }
  return parsed;
}

/** Score job fit via the agent. Throws `AiUnavailableError` when it can't. */
export async function resolveFitScore(input: ScoreFitInput): Promise<FitScoreOutput> {
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
  if (!validateFitScoreOutput(scored)) throw new AiUnavailableError(UNUSABLE_ANSWER);
  return scored;
}

/** Draft outreach via the agent. Throws `AiUnavailableError` when it can't. */
export async function resolveOutreachDraft(
  payload: DraftOutreachBody & { company?: string; retrieved_context?: string[] },
): Promise<OutreachDraftResult> {
  const draft = await callAgent<OutreachDraftResult>('/draft-outreach', {
    message_type: payload.message_type,
    contact_name: payload.contact_name,
    contact_role: payload.contact_role,
    company: payload.company,
    job_context: payload.job_context,
    resume_summary: payload.resume_summary,
    retrieved_context: payload.retrieved_context,
  });
  if (!draft || typeof draft.draft_text !== 'string' || !draft.draft_text.trim()) {
    throw new AiUnavailableError(UNUSABLE_ANSWER);
  }
  return draft;
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

  const layout = normalizeLayout(obj.layout);

  return {
    basics,
    work,
    education,
    skills,
    ...(projects ? { projects } : {}),
    ...(certificates ? { certificates } : {}),
    ...(layout ? { layout } : {}),
  };
}

/**
 * Ask the agent for edits to the base résumé's lines for one posting (#351). One paid call,
 * never re-sent; an answer that isn't the expected shape is an `AiUnavailableError`.
 */
export async function resolveTailorResume(request: TailorAgentRequest): Promise<TailorAnswer & { model_used: string }> {
  const answer = await withColdStartWake(() => callAgent<unknown>('/tailor-resume', request, AGENT_TIMEOUT_MS));
  if (!isTailorAnswer(answer)) {
    console.warn('agent /tailor-resume returned an unusable answer');
    throw new AiUnavailableError(UNUSABLE_ANSWER);
  }
  return answer;
}

/** Parse résumé text into a StructuredResume via the agent. Throws `AiUnavailableError` when it can't. */
export async function resolveResumeParse(resumeText: string): Promise<StructuredResume> {
  const parsed = await withColdStartWake(() =>
    callAgent<unknown>('/parse-resume', { resume_text: resumeText }, AGENT_TIMEOUT_MS),
  );
  const normalized = normalizeStructuredResume(parsed);
  if (!normalized) throw new AiUnavailableError(UNUSABLE_ANSWER);
  return normalized;
}

