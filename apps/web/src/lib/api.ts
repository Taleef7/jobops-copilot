import type { Job } from '@/types/job';

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
  resumeText: string;
  profileText: string;
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
      resume_text: payload.resumeText,
      profile_text: payload.profileText,
    }),
  });
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(new URL(path, apiBaseUrl), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

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
