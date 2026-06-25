import type { Job, OutreachMessageType, OutreachStatus, WeeklyReport } from '@/types/job';

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');

export interface ApiErrorFields {
  [field: string]: string;
}

export class ApiRequestError extends Error {
  status: number;

  fields?: ApiErrorFields;

  constructor(message: string, status: number, fields?: ApiErrorFields) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.fields = fields;
  }
}

export interface JobsResponse {
  jobs: Job[];
}

export interface JobResponse {
  job: Job;
}

export interface CreateJobPayload {
  jobUrl?: string;
  source?: string;
  company: string;
  title: string;
  location?: string;
  employmentType?: string;
  workplaceType?: Job['workplaceType'];
  datePosted?: string;
  priority?: Job['priority'];
  notes?: string;
  descriptionText: string;
}

export interface UpdateJobPayload {
  status?: Job['status'];
  priority?: Job['priority'];
  notes?: string;
  fitScore?: number | null;
  nextAction?: string;
  nextActionDue?: string;
}

export interface ParseJobPayload {
  jobId?: string;
  descriptionText: string;
}

export interface ParseJobResponse {
  job_id: string | null;
  company: string | null;
  title: string | null;
  required_skills: string[];
  preferred_skills: string[];
  responsibilities: string[];
  seniority: 'junior' | 'mid' | 'senior' | 'lead' | 'unknown';
  cloud_tools: string[];
  automation_tools: string[];
  summary: string;
}

export interface ScoreFitPayload {
  jobId: string;
  // Optional: when omitted the API grounds scoring in the user's saved profile.
  resumeText?: string;
  profileText?: string;
}

export interface ScoreFitResponse {
  job_id: string;
  fit_score: number;
  matched_skills: string[];
  missing_skills: string[];
  ats_keywords: string[];
  fit_summary: string;
  recommended_resume_angle: string;
  apply_recommendation: 'apply' | 'review' | 'pass';
  confidence_score: number;
  model_used: string;
}

export interface DraftOutreachPayload {
  jobId?: string;
  messageType: OutreachMessageType;
  contactName?: string;
  contactRole?: string;
  contactEmail?: string;
  jobContext?: string;
  resumeSummary?: string;
}

export interface DraftOutreachResponse {
  subject: string;
  draft_text: string;
  safety_notes: string;
  outreach_id: string;
  job_id: string | null;
  gmail_draft_status: 'created' | 'skipped' | 'failed';
  gmail_draft_id: string | null;
  gmail_draft_message: string;
}

export interface UpdateOutreachPayload {
  status?: OutreachStatus;
  gmailDraftId?: string;
  sentAt?: string;
  followUpDue?: string;
}

export interface UpdateOutreachResponse {
  outreach: Job['outreach'][number];
}

export interface WeeklyReportsResponse {
  reports: WeeklyReport[];
}

export interface WeeklyReportResponse {
  report: WeeklyReport;
}

export async function fetchJobs(): Promise<Job[]> {
  const response = await requestJson<JobsResponse>('/api/jobs', { cache: 'no-store' });
  return response.jobs;
}

export async function fetchJob(jobId: string): Promise<Job> {
  const response = await requestJson<JobResponse>(`/api/jobs/${jobId}`, { cache: 'no-store' });
  return response.job;
}

export async function createJob(payload: CreateJobPayload): Promise<Job> {
  const response = await requestJson<JobResponse>('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.job;
}

export async function updateJob(jobId: string, payload: UpdateJobPayload): Promise<Job> {
  const response = await requestJson<JobResponse>(`/api/jobs/${jobId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.job;
}

export async function parseJob(payload: ParseJobPayload): Promise<ParseJobResponse> {
  return requestJson<ParseJobResponse>('/api/ai/parse-job', {
    method: 'POST',
    body: JSON.stringify({
      job_id: payload.jobId,
      description_text: payload.descriptionText,
    }),
  });
}

export async function scoreFit(payload: ScoreFitPayload): Promise<ScoreFitResponse> {
  return requestJson<ScoreFitResponse>('/api/ai/score-fit', {
    method: 'POST',
    body: JSON.stringify({
      job_id: payload.jobId,
      ...(payload.resumeText ? { resume_text: payload.resumeText } : {}),
      ...(payload.profileText ? { profile_text: payload.profileText } : {}),
    }),
  });
}

export async function draftOutreach(payload: DraftOutreachPayload): Promise<DraftOutreachResponse> {
  return requestJson<DraftOutreachResponse>('/api/ai/draft-outreach', {
    method: 'POST',
    body: JSON.stringify({
      job_id: payload.jobId,
      message_type: payload.messageType,
      contact_name: payload.contactName,
      contact_role: payload.contactRole,
      contact_email: payload.contactEmail,
      job_context: payload.jobContext,
      resume_summary: payload.resumeSummary,
    }),
  });
}

export async function updateOutreach(
  outreachId: string,
  payload: UpdateOutreachPayload,
): Promise<UpdateOutreachResponse> {
  return requestJson<UpdateOutreachResponse>(`/api/outreach/${outreachId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export interface InterviewPrepResponse {
  likely_questions: string[];
  talking_points: string[];
  gaps_to_address: string[];
  questions_to_ask: string[];
}

export interface ResearchBriefResponse {
  company_summary: string;
  recent_signals: string[];
  role_context: string;
  talking_points: string[];
  questions_to_ask: string[];
  used_web_search: boolean;
}

export interface SkillGapItemResponse {
  skill: string;
  why_it_matters: string;
  learning_resources: string[];
  estimated_time: string;
}

export interface SkillGapPlanResponse {
  summary: string;
  prioritized_skills: SkillGapItemResponse[];
}

export async function runInterviewPrep(payload: {
  jobId: string;
  resumeText?: string;
}): Promise<InterviewPrepResponse> {
  return requestJson<InterviewPrepResponse>('/api/ai/agents/interview-prep', {
    method: 'POST',
    body: JSON.stringify({ job_id: payload.jobId, resume_text: payload.resumeText }),
  });
}

export async function runResearch(payload: { jobId: string }): Promise<ResearchBriefResponse> {
  return requestJson<ResearchBriefResponse>('/api/ai/agents/research', {
    method: 'POST',
    body: JSON.stringify({ job_id: payload.jobId }),
  });
}

export async function runSkillGap(payload: {
  jobId: string;
  resumeText?: string;
}): Promise<SkillGapPlanResponse> {
  return requestJson<SkillGapPlanResponse>('/api/ai/agents/skill-gap', {
    method: 'POST',
    body: JSON.stringify({ job_id: payload.jobId, resume_text: payload.resumeText }),
  });
}

/** Store-side agent kinds, as persisted by the API (mapped to panel tabs client-side). */
export type AgentOutputKind = 'interview_prep' | 'research' | 'skill_gap';

export interface AgentOutputItem {
  jobId: string;
  kind: AgentOutputKind;
  /** The raw agent response JSON, stored verbatim (shape depends on `kind`). */
  payload: unknown;
  modelUsed?: string;
  createdAt: string;
}

/** The persisted agent outputs for a job — `GET /api/jobs/:id/agent-outputs`. */
export async function fetchAgentOutputs(jobId: string): Promise<AgentOutputItem[]> {
  const response = await requestJson<{ outputs: AgentOutputItem[] }>(
    `/api/jobs/${jobId}/agent-outputs`,
    { cache: 'no-store' },
  );
  return response.outputs;
}

export interface TelemetryInsightsResponse {
  metric: string;
  total: number;
  trend: string;
  moving_average_7d: number;
  anomaly_dates: string[];
  forecast_next: number;
  narrative: string;
  recommendations: string[];
  series_labels: string[];
  series_values: number[];
  llm_used: boolean;
}

export async function fetchTelemetryInsights(): Promise<TelemetryInsightsResponse> {
  return requestJson<TelemetryInsightsResponse>('/api/telemetry/insights', { cache: 'no-store' });
}

export async function fetchEvTelemetryDemo(): Promise<TelemetryInsightsResponse> {
  return requestJson<TelemetryInsightsResponse>('/api/telemetry/ev-demo', { cache: 'no-store' });
}

export interface SystemStatus {
  storeMode: string;
  agent: {
    enabled: boolean;
    reachable: boolean;
    llm_configured?: boolean;
    provider?: string | null;
    model?: string | null;
    rag_enabled?: boolean;
    tavily_configured?: boolean;
  };
  integrations: { gmailDrafts: boolean; n8nWebhook: boolean; tavily: boolean };
}

export async function fetchStatus(): Promise<SystemStatus> {
  return requestJson<SystemStatus>('/api/status', { cache: 'no-store' });
}

export interface UserProfile {
  displayName: string | null;
  resumeFileName: string | null;
  hasResume: boolean;
  profileText: string | null;
  updatedAt: string | null;
}

export async function fetchProfile(): Promise<UserProfile | null> {
  const response = await requestJson<{ profile: UserProfile | null }>('/api/profile', {
    cache: 'no-store',
  });
  return response.profile;
}

export async function updateProfile(payload: {
  displayName?: string;
  profileText?: string;
}): Promise<UserProfile | null> {
  const response = await requestJson<{ profile: UserProfile | null }>('/api/profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return response.profile;
}

/** Uploads a resume PDF (client-only; routed through the proxy for auth). */
export async function uploadResumeFile(file: File): Promise<UserProfile | null> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/proxy/api/profile/resume', { method: 'POST', body: form });
  if (!response.ok) {
    throw new ApiRequestError('Failed to upload resume', response.status);
  }
  const data = (await response.json()) as { profile: UserProfile | null };
  return data.profile;
}

export async function saveResumeText(resumeText: string): Promise<UserProfile | null> {
  const response = await requestJson<{ profile: UserProfile | null }>('/api/profile/resume', {
    method: 'POST',
    body: JSON.stringify({ resume_text: resumeText }),
  });
  return response.profile;
}

export async function seedDemoData(): Promise<void> {
  await requestJson('/api/demo/seed', { method: 'POST', body: '{}' });
}

export async function clearMyData(): Promise<void> {
  await requestJson('/api/demo/clear', { method: 'POST', body: '{}' });
}

export async function fetchWeeklyReports(): Promise<WeeklyReport[]> {
  const response = await requestJson<WeeklyReportsResponse>('/api/reports', { cache: 'no-store' });
  return response.reports;
}

export async function fetchLatestWeeklyReport(): Promise<WeeklyReport | undefined> {
  try {
    const response = await requestJson<WeeklyReportResponse>('/api/reports/latest', { cache: 'no-store' });
    return response.report;
  } catch {
    return undefined;
  }
}

/**
 * Issues an authenticated API request. On the server we call the Express API
 * directly, attaching the Clerk session token + shared secret. In the browser
 * we route through the same-origin Next proxy (`/api/proxy/*`) which attaches
 * auth server-side, so the token is never exposed to client code.
 */
export interface SavedSearchItem {
  id: string;
  query: string;
  location?: string;
  remoteOnly: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function fetchSavedSearches(): Promise<SavedSearchItem[]> {
  const response = await requestJson<{ savedSearches: SavedSearchItem[] }>('/api/saved-searches', {
    cache: 'no-store',
  });
  return response.savedSearches;
}

export async function createSavedSearch(payload: {
  query: string;
  location?: string;
  remoteOnly?: boolean;
}): Promise<SavedSearchItem> {
  const response = await requestJson<{ savedSearch: SavedSearchItem }>('/api/saved-searches', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.savedSearch;
}

export async function deleteSavedSearch(id: string): Promise<void> {
  await requestJson<{ deleted: boolean }>(`/api/saved-searches/${id}`, { method: 'DELETE' });
}

export interface DiscoveryRunResult {
  inserted: number;
  skipped: number;
  source: string;
}

export async function runDiscovery(): Promise<DiscoveryRunResult> {
  return requestJson<DiscoveryRunResult>('/api/discovery/run', { method: 'POST', body: '{}' });
}

export interface ExtractedJobResponse {
  title?: string;
  company?: string;
  location?: string;
  descriptionText?: string;
  workplaceType?: 'remote' | 'hybrid' | 'onsite' | 'flexible';
  source: 'jsonld' | 'opengraph' | 'heuristic' | 'none';
}

export async function extractJobFromUrl(url: string): Promise<ExtractedJobResponse> {
  return requestJson<ExtractedJobResponse>('/api/jobs/extract', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

async function apiFetch(path: string, init: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };

  if (typeof window === 'undefined') {
    const { auth } = await import('@clerk/nextjs/server');
    const { getToken } = await auth();
    const token = await getToken();
    const sharedSecret = process.env.API_SHARED_SECRET?.trim();
    return fetch(new URL(path, apiBaseUrl), {
      ...init,
      headers: {
        ...headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(sharedSecret ? { 'X-API-Key': sharedSecret } : {}),
      },
    });
  }

  return fetch(`/api/proxy${path}`, { ...init, headers });
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);

  if (!response.ok) {
    let fields: ApiErrorFields | undefined;
    let message = `Request failed with status ${response.status}`;

    try {
      const payload = (await response.json()) as { error?: string; fields?: ApiErrorFields };
      message = payload.error ?? message;
      fields = payload.fields;
    } catch {
      // Ignore non-JSON error bodies and keep the generic message.
    }

    throw new ApiRequestError(message, response.status, fields);
  }

  return (await response.json()) as T;
}
