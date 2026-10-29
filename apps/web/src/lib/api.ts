import type {
  ApplicationPackPayload,
  CoverLetterLength,
  CoverLetterRecord,
  FeedQueryOptions,
  FeedResult,
  Job,
  JobContactRecord,
  JobContactStatus,
  OutreachDraft,
  OutreachMessageType,
  OutreachStatus,
  ResumeLayout,
  ResumeVersionRecord,
  StructuredResume,
  WeeklyReport,
} from '@/types/job';
import type {
  NotificationItem,
  NotificationSettings,
} from '@/types/notification';
import type { LlmCanaryResult } from '@/lib/llm-check';
import { AI_REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from '@/lib/timeouts';

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');

export interface ApiErrorFields {
  [field: string]: string;
}

export class ApiRequestError extends Error {
  status: number;

  fields?: ApiErrorFields;

  /** On a 409, the job the request duplicates (#346). */
  existingJobId?: string;

  /** The API's reason, when it gives one, e.g. 'BASE_RESUME_EMPTY' (#351). */
  code?: string;

  constructor(message: string, status: number, fields?: ApiErrorFields, existingJobId?: string, code?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.fields = fields;
    this.existingJobId = existingJobId;
    this.code = code;
  }
}

/**
 * What to tell the user when a call fails: the API's own reason (which now also covers a
 * timeout or an unreachable API, #349), else the caller's plain fallback.
 */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
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
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  seniority?: Job['seniority'];
  sponsorLikelihood?: Job['sponsorLikelihood'];
  contentHash?: string | null;
  lastSeenAt?: string | null;
  liveness?: Job['liveness'];
}

export interface UpdateJobPayload {
  status?: Job['status'];
  priority?: Job['priority'];
  /** null clears it, as for nextAction and nextActionDue; left out, it's unchanged. */
  notes?: string | null;
  fitScore?: number | null;
  nextAction?: string | null;
  nextActionDue?: string | null;
}

export interface ParseJobPayload {
  jobId?: string;
  descriptionText: string;
}

/** A salary as the API reads it from a posting (#355). */
export interface PostedSalary {
  min: number | null;
  max: number | null;
  currency: string;
}

export interface ParseJobResponse {
  job_id: string | null;
  company: string | null;
  title: string | null;
  /** Null when the posting doesn't say. Left out when unknown: an agent or API from before
   *  #355, or a workplace word the app doesn't know. */
  location?: string | null;
  workplace_type?: 'remote' | 'hybrid' | 'onsite' | 'flexible' | null;
  /** The salary as the store will save it from this description, or null. */
  salary?: PostedSalary | null;
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
  matched_skill_details?: { skill: string; evidence: string }[];
  missing_skill_details?: { skill: string; posting_quote: string }[];
  ats_keywords: string[];
  fit_summary: string;
  recommended_resume_angle: string;
  apply_recommendation: 'apply' | 'review' | 'pass';
  confidence_score: number | null;
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

export async function fetchRankedFeed(options: FeedQueryOptions = {}): Promise<FeedResult> {
  const params = new URLSearchParams();
  if (options.limit != null) params.set('limit', String(options.limit));
  if (options.offset != null) params.set('offset', String(options.offset));
  if (options.minScore != null) params.set('min_score', String(options.minScore));
  if (options.seniority) params.set('seniority', options.seniority);
  if (options.sponsorOnly) params.set('sponsor_only', 'true');
  if (options.status) params.set('status', options.status);
  if (options.workplaceType) params.set('workplace_type', options.workplaceType);

  const query = params.toString();
  const path = query ? `/api/feed?${query}` : '/api/feed';
  return requestJson<FeedResult>(path, { cache: 'no-store' });
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
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
    method: 'POST',
    body: JSON.stringify({
      job_id: payload.jobId,
      description_text: payload.descriptionText,
    }),
  });
}

export async function scoreFit(payload: ScoreFitPayload): Promise<ScoreFitResponse> {
  return requestJson<ScoreFitResponse>('/api/ai/score-fit', {
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
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
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
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
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
    method: 'POST',
    body: JSON.stringify({ job_id: payload.jobId, resume_text: payload.resumeText }),
  });
}

export async function runResearch(payload: { jobId: string }): Promise<ResearchBriefResponse> {
  return requestJson<ResearchBriefResponse>('/api/ai/agents/research', {
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
    method: 'POST',
    body: JSON.stringify({ job_id: payload.jobId }),
  });
}

export async function runSkillGap(payload: {
  jobId: string;
  resumeText?: string;
}): Promise<SkillGapPlanResponse> {
  return requestJson<SkillGapPlanResponse>('/api/ai/agents/skill-gap', {
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
    method: 'POST',
    body: JSON.stringify({ job_id: payload.jobId, resume_text: payload.resumeText }),
  });
}

/** Store-side agent kinds, as persisted by the API (mapped to panel tabs client-side). */
export type AgentOutputKind = 'interview_prep' | 'research' | 'skill_gap' | 'application_pack';

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
  return requestJson<TelemetryInsightsResponse>('/api/telemetry/insights', {
    cache: 'no-store',
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
  });
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
  /** The last scheduled LLM canary (#348); null before the first run. */
  llmCanary?: LlmCanaryResult | null;
}

export async function fetchStatus(): Promise<SystemStatus> {
  return requestJson<SystemStatus>('/api/status', { cache: 'no-store' });
}

export interface UserProfile {
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
  profileText?: string;
}): Promise<UserProfile | null> {
  const response = await requestJson<{ profile: UserProfile | null }>('/api/profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return response.profile;
}

export interface ResumeUploadResult {
  /** Null for a preview, which stores nothing. */
  profile: UserProfile | null;
  /** The text read from the PDF (#350), shown so a misread is visible before it spreads. */
  resumeText: string | null;
  resumeFileName: string | null;
}

/**
 * Uploads a resume PDF (client-only; routed through the proxy for auth). With `preview`,
 * the API only reads it and stores nothing: Settings stores the text once the user
 * confirms what was read (#350), with saveBaseResume, in the same write as the résumé.
 */
export async function uploadResumeFile(file: File, options: { preview?: boolean } = {}): Promise<ResumeUploadResult> {
  const form = new FormData();
  form.append('file', file);
  let response: Response;
  try {
    // The upload can parse the resume with the AI, so it gets the AI limit (#349).
    response = await fetch(`/api/proxy/api/profile/resume${options.preview ? '?preview=1' : ''}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw requestFailure(error);
  }
  if (!response.ok) {
    // The API says why (not a PDF, too large, unreadable); show that, not a generic failure.
    let message = 'Failed to upload resume';
    try {
      const payload = (await response.json()) as { error?: string };
      message = payload.error ?? message;
    } catch {
      // Keep the generic message for a non-JSON error body.
    }
    throw new ApiRequestError(message, response.status);
  }
  const data = (await response.json()) as { profile?: UserProfile | null; resumeText?: string; resumeFileName?: string | null };
  return { profile: data.profile ?? null, resumeText: data.resumeText ?? null, resumeFileName: data.resumeFileName ?? null };
}

export async function saveResumeText(resumeText: string): Promise<UserProfile | null> {
  const response = await requestJson<{ profile: UserProfile | null }>('/api/profile/resume', {
    method: 'POST',
    body: JSON.stringify({ resume_text: resumeText }),
  });
  return response.profile;
}

export interface BaseResumeResult {
  baseResume: StructuredResume | null;
  /** When it was last saved; null when there is none. */
  updatedAt: string | null;
}

/** Fetch the user's canonical structured base resume, and when it was last saved. */
export async function fetchBaseResume(): Promise<BaseResumeResult> {
  const response = await requestJson<{ baseResume: StructuredResume | null; updatedAt?: string | null }>(
    '/api/profile/base-resume',
    { cache: 'no-store' },
  );
  return { baseResume: response.baseResume, updatedAt: response.updatedAt ?? null };
}

export interface ResumeText {
  resumeText: string | null;
  resumeFileName: string | null;
  updatedAt: string | null;
}

/** The text read from the user's résumé, for "What we read from your PDF" (#350). */
export async function fetchResumeText(): Promise<ResumeText> {
  return requestJson<ResumeText>('/api/profile/resume-text', { cache: 'no-store' });
}

/** The text of the file a résumé was read from, and the file's name. */
export interface ResumeSource {
  text: string;
  fileName: string | null;
}

/**
 * Save or update the user's canonical structured base resume. A résumé read from a new
 * file is saved with that file's text (`source`), in one write (#350).
 */
export async function saveBaseResume(baseResume: StructuredResume, source?: ResumeSource | null): Promise<StructuredResume> {
  const response = await requestJson<{ baseResume: StructuredResume }>(
    '/api/profile/base-resume',
    {
      method: 'PUT',
      body: JSON.stringify(
        source ? { baseResume, resumeText: source.text, resumeFileName: source.fileName } : { baseResume },
      ),
    },
  );
  return response.baseResume;
}

/**
 * Save the base résumé's layout (#415): its sections' order, headings and visibility, or the
 * page size. Only the fields sent change; answers with the whole layout as saved.
 */
export async function saveResumeLayout(patch: ResumeLayout): Promise<ResumeLayout> {
  const response = await requestJson<{ layout: ResumeLayout }>('/api/profile/base-resume/layout', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return response.layout;
}

export interface ResumePdf {
  blob: Blob;
  /** How many pages it runs to. */
  pages: number;
  /** Characters its font can't print (CJK, emoji), shown as "?" (#429). */
  unsupported: number;
}

/** The saved base résumé's PDF, in its layout (#415). The API renders it and stores nothing. */
export async function fetchBaseResumePdf(): Promise<ResumePdf> {
  let res: Response;
  try {
    res = await fetch('/api/proxy/api/profile/base-resume/pdf', { cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw requestFailure(error);
  }
  if (!res.ok) {
    const errorData = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiRequestError(errorData.error || "The PDF couldn't be made. Try again in a moment.", res.status);
  }
  return {
    blob: await res.blob(),
    pages: Number(res.headers.get('x-page-count') ?? 0) || 0,
    unsupported: Number(res.headers.get('x-pdf-unsupported-characters') ?? 0) || 0,
  };
}

/** Downloads the saved base résumé's PDF as `filename` ("First Last – Résumé.pdf"). */
export async function downloadBaseResumePdf(filename: string): Promise<{ pages: number; unsupported: number }> {
  const { blob, pages, unsupported } = await fetchBaseResumePdf();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
  return { pages, unsupported };
}

/** A parsed field that looks misread (#350), held on the confirmation screen. */
export interface ResumeFlag {
  /** Where it is, e.g. `work[0].company`. */
  path: string;
  value: string;
  reason: string;
}

export interface ResumeParseResult {
  structuredResume: StructuredResume;
  flags: ResumeFlag[];
}

/**
 * Read résumé text into a StructuredResume with the AI: the stored text, or `resumeText`.
 * Nothing is saved; the confirmation screen saves it with saveBaseResume.
 */
export async function parseResume(resumeText?: string): Promise<ResumeParseResult> {
  const response = await requestJson<{ structuredResume: StructuredResume; flags?: ResumeFlag[] }>(
    '/api/profile/base-resume/parse-resume',
    {
      timeoutMs: AI_REQUEST_TIMEOUT_MS,
      method: 'POST',
      body: JSON.stringify(resumeText ? { resume_text: resumeText } : {}),
    },
  );
  return { structuredResume: response.structuredResume, flags: response.flags ?? [] };
}

/** Fetch all tailored resume versions for a specific job. */
export async function fetchJobResumeVersions(jobId: string): Promise<ResumeVersionRecord[]> {
  const response = await requestJson<{ versions: ResumeVersionRecord[] }>(
    `/api/jobs/${jobId}/resume-versions`,
    { cache: 'no-store' },
  );
  return response.versions;
}

/** The posting's keywords for the tailor window, and which the base résumé has (#351). */
export async function getTailorKeywords(
  jobId: string,
): Promise<{ fitRead: boolean; keywords: Array<{ term: string; onResume: boolean }> }> {
  return await requestJson(`/api/jobs/${jobId}/tailor/keywords`);
}

/**
 * Tailor the base résumé to a job's posting (#351). `confirmedKeywords` are the ones the user
 * says they have; `addToBase` also puts them on the base résumé.
 */
export async function tailorResumeForJob(
  jobId: string,
  options?: { confirmedKeywords?: string[]; addToBase?: boolean },
): Promise<{ version: ResumeVersionRecord; addedToBase?: boolean }> {
  // addedToBase: false when the draft was saved but the keywords couldn't go into the base résumé.
  return requestJson<{ version: ResumeVersionRecord; addedToBase?: boolean }>(`/api/jobs/${jobId}/tailor`, {
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
    method: 'POST',
    body: JSON.stringify(options ?? {}),
  });
}

/** Approve a tailored resume draft version. */
export async function approveResumeVersion(
  versionId: string,
): Promise<{ version: ResumeVersionRecord; fileUrl?: string; approved: boolean }> {
  return await requestJson<{ version: ResumeVersionRecord; fileUrl?: string; approved: boolean }>(
    `/api/resume-versions/${versionId}/approve`,
    { method: 'POST', body: '{}' },
  );
}

/** Keep, restore or edit one line of a tailored draft (#351). */
export async function reviewResumeChange(
  versionId: string,
  changeId: string,
  action: 'keep' | 'restore' | 'edit',
  text?: string,
): Promise<ResumeVersionRecord> {
  const response = await requestJson<{ version: ResumeVersionRecord }>(
    `/api/resume-versions/${versionId}/changes/${changeId}`,
    { method: 'PATCH', body: JSON.stringify(text === undefined ? { action } : { action, text }) },
  );
  return response.version;
}

/**
 * Trigger gated browser download for an approved resume version PDF.
 */
/**
 * Downloads an approved tailored résumé. `unsupported`: characters the PDF's font can't print
 * (CJK, emoji), shown as "?" (#429), so the page can say so.
 */
export async function downloadResumeVersion(versionId: string, filename?: string): Promise<{ unsupported: number }> {
  const res = await fetch(`/api/proxy/api/resume-versions/${versionId}/download`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: 'Download failed' }));
    throw new Error(errorData.error || `Download failed with status ${res.status}`);
  }
  const unsupported = Number(res.headers.get('x-pdf-unsupported-characters') ?? 0) || 0;
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `tailored-resume-${versionId}.pdf`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
  return { unsupported };
}

/** The job's cover letter, or null before one is written (#416). */
export async function getCoverLetter(jobId: string): Promise<CoverLetterRecord | null> {
  const response = await requestJson<{ coverLetter: CoverLetterRecord | null }>(`/api/jobs/${jobId}/cover-letter`, { cache: 'no-store' });
  return response.coverLetter;
}

/**
 * Write the job's cover letter, Concise or Full, replacing the one it had (#416).
 * `confirmedKeywords` are the keywords the user said they have in the tailor window.
 */
export async function writeCoverLetter(
  jobId: string,
  options: { length: CoverLetterLength; confirmedKeywords: string[] },
): Promise<CoverLetterRecord> {
  const response = await requestJson<{ coverLetter: CoverLetterRecord }>(`/api/jobs/${jobId}/cover-letter`, {
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
    method: 'POST',
    body: JSON.stringify(options),
  });
  return response.coverLetter;
}

/**
 * The user's own words for one paragraph of the letter, onto the letter as it was read.
 * `expectedText` is the paragraph as the page shows it: the API refuses (409) if it moved.
 */
export async function editCoverLetterParagraph(
  jobId: string,
  index: number,
  text: string,
  updatedAt: string,
  expectedText: string,
): Promise<CoverLetterRecord> {
  const response = await requestJson<{ coverLetter: CoverLetterRecord }>(`/api/jobs/${jobId}/cover-letter/paragraphs/${index}`, {
    method: 'PATCH',
    body: JSON.stringify({ text, expectedText, updatedAt }),
  });
  return response.coverLetter;
}

/**
 * Keep a flagged sentence, or remove it from its paragraph (#416). `expectedText` is that paragraph
 * as the page shows it: the API refuses (409) if it changed.
 */
export async function resolveCoverLetterFlag(
  jobId: string,
  checkId: string,
  action: 'keep' | 'remove',
  expectedText: string,
  updatedAt: string,
): Promise<CoverLetterRecord> {
  const response = await requestJson<{ coverLetter: CoverLetterRecord }>(
    `/api/jobs/${jobId}/cover-letter/checks/${encodeURIComponent(checkId)}`,
    { method: 'PATCH', body: JSON.stringify({ action, expectedText, updatedAt }) },
  );
  return response.coverLetter;
}

/** Remove one paragraph of the letter (not the last), the one the page shows as `expectedText`. */
export async function removeCoverLetterParagraph(
  jobId: string,
  index: number,
  updatedAt: string,
  expectedText: string,
): Promise<CoverLetterRecord> {
  const response = await requestJson<{ coverLetter: CoverLetterRecord }>(`/api/jobs/${jobId}/cover-letter/paragraphs/${index}`, {
    method: 'DELETE',
    body: JSON.stringify({ expectedText, updatedAt }),
  });
  return response.coverLetter;
}

/** "First Last – Company – Cover letter.pdf", from the API's Content-Disposition. */
function fileNameOf(disposition: string | null, fallback: string): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? '')?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // A malformed name: the fallback.
    }
  }
  return /filename="([^"]+)"/i.exec(disposition ?? '')?.[1] ?? fallback;
}

/**
 * Downloads the job's cover letter as a one-page PDF dated `date` (the user's local date,
 * YYYY-MM-DD). `unsupported`: characters its font can't print, shown as "?".
 */
export async function downloadCoverLetter(jobId: string, date: string): Promise<{ unsupported: number }> {
  const res = await fetch(`/api/proxy/api/jobs/${jobId}/cover-letter/download?date=${encodeURIComponent(date)}`);
  if (!res.ok) {
    // Its status and code stay with it: a 409 FLAGS_UNRESOLVED has the page read the letter again.
    const payload = (await res.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
    throw new ApiRequestError(
      typeof payload.error === 'string' && payload.error ? payload.error : `Download failed with status ${res.status}`,
      res.status,
      undefined,
      undefined,
      typeof payload.code === 'string' ? payload.code : undefined,
    );
  }
  const unsupported = Number(res.headers.get('x-pdf-unsupported-characters') ?? 0) || 0;
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileNameOf(res.headers.get('content-disposition'), 'Cover letter.pdf');
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
  return { unsupported };
}

/**
 * Trigger browser download for a rendered cover letter PDF.
 */
export async function downloadCoverLetterPdf(outreachId: string, filename?: string): Promise<void> {
  const res = await fetch(`/api/proxy/api/outreach/${outreachId}/download-pdf`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: 'Download failed' }));
    throw new Error(errorData.error || `Download failed with status ${res.status}`);
  }
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `cover-letter-${outreachId}.pdf`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

export interface ApplicationAnswerRecord {
  id: string;
  userId: string;
  questionHash: string;
  questionText: string;
  answer: string;
  ats?: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchJobApplicationPack(jobId: string): Promise<ApplicationPackPayload | null> {
  try {
    const response = await requestJson<{ applicationPack: ApplicationPackPayload }>(
      `/api/jobs/${jobId}/application-pack`,
      { cache: 'no-store' },
    );
    return response.applicationPack;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function generateJobApplicationPack(jobId: string): Promise<ApplicationPackPayload> {
  const response = await requestJson<{ applicationPack: ApplicationPackPayload }>(
    `/api/jobs/${jobId}/application-pack`,
    {
      timeoutMs: AI_REQUEST_TIMEOUT_MS,
      method: 'POST',
      body: JSON.stringify({}),
    },
  );
  return response.applicationPack;
}

export async function fetchApplicationAnswers(): Promise<ApplicationAnswerRecord[]> {
  const response = await requestJson<{ answers: ApplicationAnswerRecord[] }>('/api/answers', {
    cache: 'no-store',
  });
  return response.answers;
}

export async function saveApplicationAnswer(payload: {
  questionText: string;
  answer: string;
  ats?: string;
}): Promise<ApplicationAnswerRecord> {
  const response = await requestJson<{ answer: ApplicationAnswerRecord }>('/api/answers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.answer;
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

export type TargetCompanyBoardType = 'greenhouse' | 'lever' | 'ashby';

export interface TargetCompanyItem {
  id: string;
  company: string;
  boardType: TargetCompanyBoardType;
  boardToken: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function fetchTargetCompanies(): Promise<TargetCompanyItem[]> {
  const response = await requestJson<{ targetCompanies: TargetCompanyItem[] }>('/api/target-companies', {
    cache: 'no-store',
  });
  return response.targetCompanies;
}

export async function createTargetCompany(payload: {
  company: string;
  boardType: TargetCompanyBoardType;
  boardToken: string;
}): Promise<TargetCompanyItem> {
  const response = await requestJson<{ targetCompany: TargetCompanyItem }>('/api/target-companies', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.targetCompany;
}

export async function setTargetCompanyEnabled(id: string, enabled: boolean): Promise<TargetCompanyItem> {
  const response = await requestJson<{ targetCompany: TargetCompanyItem }>(`/api/target-companies/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
  return response.targetCompany;
}

export async function deleteTargetCompany(id: string): Promise<void> {
  await requestJson<{ deleted: boolean }>(`/api/target-companies/${id}`, { method: 'DELETE' });
}

export interface DiscoveryRunResult {
  inserted: number;
  skipped: number;
  source: string;
}

export async function runDiscovery(): Promise<DiscoveryRunResult> {
  return requestJson<DiscoveryRunResult>('/api/discovery/run', {
    method: 'POST',
    body: '{}',
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
  });
}

export interface ExtractedJobResponse {
  title?: string;
  company?: string;
  location?: string;
  descriptionText?: string;
  workplaceType?: 'remote' | 'hybrid' | 'onsite' | 'flexible';
  /**
   * For the Add job review (#355): the salary as the store will save it from this
   * description, or null. Left out when there's no description, only the page's meta
   * description, or the API is from before #355.
   */
  salary?: PostedSalary | null;
  source: 'jsonld' | 'opengraph' | 'heuristic' | 'none';
}

export async function extractJobFromUrl(url: string): Promise<ExtractedJobResponse> {
  return requestJson<ExtractedJobResponse>('/api/jobs/extract', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export interface JobContactsResponse {
  contacts: JobContactRecord[];
}

export interface CreateJobContactInput {
  name: string;
  roleTitle: string;
  linkedinUrl?: string;
  /** Other links about the person (GitHub, a team page); shown under "Links". */
  evidence?: string[];
  notes?: string;
}

export interface DraftContactOutreachResponse {
  contact: JobContactRecord;
  draft: OutreachDraft;
}

export async function fetchJobContacts(jobId: string): Promise<JobContactRecord[]> {
  const data = await requestJson<JobContactsResponse>(`/api/jobs/${encodeURIComponent(jobId)}/contacts`);
  return data.contacts;
}

export async function createJobContact(jobId: string, body: CreateJobContactInput): Promise<JobContactRecord> {
  const res = await requestJson<{ contact: JobContactRecord }>(`/api/jobs/${encodeURIComponent(jobId)}/contacts`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.contact;
}

export async function draftContactOutreach(contactId: string): Promise<DraftContactOutreachResponse> {
  return requestJson<DraftContactOutreachResponse>(`/api/contacts/${encodeURIComponent(contactId)}/draft-outreach`, {
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
    method: 'POST',
  });
}

export async function updateContactStatus(
  contactId: string,
  status: JobContactStatus,
  notes?: string,
): Promise<JobContactRecord> {
  const res = await requestJson<{ contact: JobContactRecord }>(`/api/contacts/${encodeURIComponent(contactId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, ...(notes !== undefined ? { notes } : {}) }),
  });
  return res.contact;
}

export async function deleteContact(contactId: string): Promise<void> {
  await requestJson<{ success: boolean }>(`/api/contacts/${encodeURIComponent(contactId)}`, {
    method: 'DELETE',
  });
}

export async function fetchNotifications(options: {
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
} = {}): Promise<{ notifications: NotificationItem[]; unreadCount: number }> {
  const params = new URLSearchParams();
  if (options.unreadOnly) params.set('unreadOnly', 'true');
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return requestJson<{ notifications: NotificationItem[]; unreadCount: number }>(`/api/notifications${qs}`);
}

export async function markNotificationRead(id: string): Promise<NotificationItem> {
  const res = await requestJson<{ notification: NotificationItem }>(
    `/api/notifications/${encodeURIComponent(id)}/read`,
    { method: 'POST' },
  );
  return res.notification;
}

export async function markAllNotificationsRead(): Promise<{ success: boolean; updatedCount: number }> {
  return requestJson<{ success: boolean; updatedCount: number }>('/api/notifications/read-all', {
    method: 'POST',
  });
}

export async function fetchNotificationSettings(): Promise<NotificationSettings> {
  const res = await requestJson<{ settings: NotificationSettings }>('/api/notification-settings');
  return res.settings;
}

export async function updateNotificationSettings(
  settings: Partial<NotificationSettings>,
): Promise<NotificationSettings> {
  const res = await requestJson<{ settings: NotificationSettings }>('/api/notification-settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
  return res.settings;
}

export async function sendTestNotification(): Promise<NotificationItem> {
  const res = await requestJson<{ notification: NotificationItem }>('/api/notifications/test', {
    method: 'POST',
  });
  return res.notification;
}

export async function fetchVapidKey(): Promise<string | null> {
  const res = await requestJson<{ publicKey: string | null }>('/api/push/vapid-key');
  return res.publicKey;
}

export async function subscribePushEndpoint(
  subscription: PushSubscription,
  userAgent?: string,
): Promise<{ success: boolean }> {
  const subJson = subscription.toJSON();
  return requestJson<{ success: boolean }>('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      subscription: {
        endpoint: subJson.endpoint,
        keys: {
          p256dh: subJson.keys?.p256dh,
          auth: subJson.keys?.auth,
        },
      },
      userAgent,
    }),
  });
}

export async function unsubscribePushEndpoint(endpoint: string): Promise<{ success: boolean }> {
  return requestJson<{ success: boolean }>('/api/push/subscribe', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
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

type RequestOptions = RequestInit & {
  /** Defaults to REQUEST_TIMEOUT_MS; AI calls pass AI_REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
};

function isTimeout(error: unknown): boolean {
  // A DOMException, which isn't an Error in every runtime, so check the name only.
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/** A request that never got an answer, in words the page can show as is (never "Failed to fetch"). */
function requestFailure(error: unknown): ApiRequestError {
  if (isTimeout(error)) {
    return new ApiRequestError('The API took too long to answer. Try again in a moment.', 408);
  }
  return new ApiRequestError("The API couldn't be reached. Try again in a moment.", 0);
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...init } = options;
  let response: Response;
  try {
    response = await apiFetch(path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw requestFailure(error);
  }

  if (!response.ok) {
    let fields: ApiErrorFields | undefined;
    let existingJobId: string | undefined;
    let code: string | undefined;
    let message = `Request failed with status ${response.status}`;

    try {
      const payload = (await response.json()) as {
        error?: string;
        fields?: ApiErrorFields;
        existingJobId?: unknown;
        code?: unknown;
      };
      message = payload.error ?? message;
      fields = payload.fields;
      existingJobId = typeof payload.existingJobId === 'string' ? payload.existingJobId : undefined;
      code = typeof payload.code === 'string' ? payload.code : undefined;
    } catch {
      // Ignore non-JSON error bodies and keep the generic message.
    }

    throw new ApiRequestError(message, response.status, fields, existingJobId, code);
  }

  return (await response.json()) as T;
}
