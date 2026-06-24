import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CreateJobBody,
  JobAnalysis,
  JobRecord,
  OutreachDraft,
  UpdateOutreachBody,
  UpdateJobBody,
} from '@/types';
import { validateJobAnalysis } from '@/lib/analysis-core';
import { deriveOutreachJobUpdate } from '@/lib/outreach-workflow';
import { hasPostgresConnection } from '@/lib/postgres';
import * as postgresStore from '@/data/job-store.postgres';
import { seedJobs } from '@/data/mock-store';

const dataDir = join(process.cwd(), 'data');
const dataFile = join(dataDir, 'jobs.json');

let jobsCache: JobRecord[] | null = null;
let loadPromise: Promise<JobRecord[]> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function defaultAnalysis(descriptionText: string): JobAnalysis {
  const keywords = extractKeywords(descriptionText);

  return {
    requiredSkills: keywords.slice(0, 5),
    preferredSkills: keywords.slice(5, 8),
    matchedSkills: [],
    missingSkills: keywords.slice(0, 3),
    atsKeywords: keywords.slice(0, 6),
    fitSummary: 'Initial placeholder analysis waiting for AI processing.',
    recommendedResumeAngle: 'Emphasize truthful, relevant experience from the current resume.',
    applyRecommendation: 'Review manually before deciding whether to apply.',
    confidenceScore: 48,
    modelUsed: 'mock-analysis-v1',
  };
}

function extractKeywords(text: string): string[] {
  const keywords = [
    'TypeScript',
    'JavaScript',
    'React',
    'Next.js',
    'Azure Functions',
    'Azure Blob Storage',
    'PostgreSQL',
    'SQL',
    'n8n',
    'Zapier',
    'Make.com',
    'OpenAI',
    'Azure OpenAI',
    'LLM',
    'Express',
    'Python',
    'Node.js',
    'Workflow automation',
    'CRM',
    'Analytics',
  ];

  return keywords.filter((keyword) => text.toLowerCase().includes(keyword.toLowerCase()));
}

function createBaseJob(userId: string, body: CreateJobBody): JobRecord {
  const timestamp = new Date().toISOString();

  return {
    id: randomUUID(),
    userId,
    jobUrl: body.jobUrl,
    source: body.source ?? 'manual',
    company: body.company.trim(),
    title: body.title.trim(),
    location: body.location?.trim() ?? 'Remote',
    employmentType: body.employmentType?.trim() ?? 'Full-time',
    workplaceType: body.workplaceType ?? 'remote',
    datePosted: body.datePosted,
    discoveredAt: timestamp,
    descriptionText: body.descriptionText.trim(),
    status: 'discovered',
    priority: body.priority ?? 'medium',
    fitScore: null,
    notes: body.notes?.trim() || undefined,
    nextAction: 'Run fit scoring to analyze this role.',
    nextActionDue: undefined,
    analysis: defaultAnalysis(body.descriptionText),
    outreach: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function seedState(): JobRecord[] {
  return clone(seedJobs);
}

export function getStoreMode() {
  return hasPostgresConnection() ? 'postgres' : 'file';
}

async function loadJobs(): Promise<JobRecord[]> {
  await mkdir(dataDir, { recursive: true });

  try {
    const raw = await readFile(dataFile, 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error('Invalid job store contents');
    }

    jobsCache = parsed as JobRecord[];
  } catch {
    jobsCache = seedState();
    await persistJobs();
  }

  return jobsCache;
}

async function ensureLoaded(): Promise<JobRecord[]> {
  if (jobsCache) {
    return jobsCache;
  }

  loadPromise ??= loadJobs();
  return loadPromise;
}

async function persistJobs() {
  if (!jobsCache) {
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await writeFile(dataFile, `${JSON.stringify(jobsCache, null, 2)}\n`, 'utf8');
}

async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const previous = mutationQueue;
  let release!: () => void;

  mutationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;

  try {
    return await operation();
  } finally {
    release();
  }
}

export async function listJobs(userId: string): Promise<JobRecord[]> {
  if (hasPostgresConnection()) {
    return postgresStore.listJobs(userId);
  }

  const jobs = await ensureLoaded();
  return clone(jobs.filter((entry) => entry.userId === userId));
}

export async function getJobById(userId: string, jobId: string): Promise<JobRecord | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.getJobById(userId, jobId);
  }

  const jobs = await ensureLoaded();
  const job = jobs.find((entry) => entry.id === jobId && entry.userId === userId);
  return job ? clone(job) : undefined;
}

export async function createJob(userId: string, body: CreateJobBody): Promise<JobRecord> {
  if (hasPostgresConnection()) {
    return postgresStore.createJob(userId, body);
  }

  return runExclusive(async () => {
    const jobs = await ensureLoaded();
    const job = createBaseJob(userId, body);
    jobs.unshift(job);
    await persistJobs();
    return clone(job);
  });
}

export async function updateJob(
  userId: string,
  jobId: string,
  body: UpdateJobBody,
): Promise<JobRecord | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.updateJob(userId, jobId, body);
  }

  return runExclusive(async () => {
    const jobs = await ensureLoaded();
    const job = jobs.find((entry) => entry.id === jobId && entry.userId === userId);

    if (!job) {
      return undefined;
    }

    if (typeof body.status !== 'undefined') {
      job.status = body.status;
    }
    if (typeof body.priority !== 'undefined') {
      job.priority = body.priority;
    }
    if (typeof body.notes !== 'undefined') {
      job.notes = body.notes.trim() || undefined;
    }
    if (typeof body.fitScore !== 'undefined') {
      job.fitScore = body.fitScore;
    }
    if (typeof body.nextAction !== 'undefined') {
      job.nextAction = body.nextAction.trim();
    }
    if (typeof body.nextActionDue !== 'undefined') {
      job.nextActionDue = body.nextActionDue || undefined;
    }

    job.updatedAt = new Date().toISOString();
    await persistJobs();
    return clone(job);
  });
}

export async function appendOutreachDraft(
  userId: string,
  jobId: string,
  draft: OutreachDraft,
): Promise<OutreachDraft | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.appendOutreachDraft(userId, jobId, draft);
  }

  return runExclusive(async () => {
    const jobs = await ensureLoaded();
    const job = jobs.find((entry) => entry.id === jobId && entry.userId === userId);

    if (!job) {
      return undefined;
    }

    const clonedDraft = clone({
      ...draft,
      jobId,
    });
    job.outreach.push(clonedDraft);
    const jobUpdate = deriveOutreachJobUpdate(job.status, job.outreach);

    if (jobUpdate) {
      job.status = jobUpdate.status;
      job.nextAction = jobUpdate.nextAction;
    }

    job.updatedAt = new Date().toISOString();
    await persistJobs();
    return clone(clonedDraft);
  });
}

export async function updateOutreachDraft(
  userId: string,
  outreachId: string,
  body: UpdateOutreachBody,
): Promise<OutreachDraft | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.updateOutreachDraft(userId, outreachId, body);
  }

  return runExclusive(async () => {
    const jobs = await ensureLoaded();

    for (const job of jobs) {
      if (job.userId !== userId) {
        continue;
      }

      const draft = job.outreach.find((entry) => entry.id === outreachId);

      if (!draft) {
        continue;
      }

      if (typeof body.status !== 'undefined') {
        draft.status = body.status;
      }
      if (typeof body.gmailDraftId !== 'undefined') {
        draft.gmailDraftId = body.gmailDraftId.trim() || undefined;
      }
      if (typeof body.sentAt !== 'undefined') {
        draft.sentAt = body.sentAt.trim() || undefined;
      }
      if (typeof body.followUpDue !== 'undefined') {
        draft.followUpDue = body.followUpDue.trim() || undefined;
      }

      if (draft.status === 'sent' && !draft.sentAt) {
        draft.sentAt = new Date().toISOString();
      }

      const jobUpdate = deriveOutreachJobUpdate(job.status, job.outreach);

      if (jobUpdate) {
        job.status = jobUpdate.status;
        job.nextAction = jobUpdate.nextAction;
      }

      job.updatedAt = new Date().toISOString();
      await persistJobs();
      return clone(draft);
    }

    return undefined;
  });
}

export async function updateOutreachGmailDraftId(
  userId: string,
  outreachId: string,
  gmailDraftId: string,
): Promise<OutreachDraft | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.updateOutreachGmailDraftId(userId, outreachId, gmailDraftId);
  }

  return runExclusive(async () => {
    const jobs = await ensureLoaded();

    for (const job of jobs) {
      if (job.userId !== userId) {
        continue;
      }

      const draft = job.outreach.find((entry) => entry.id === outreachId);

      if (!draft) {
        continue;
      }

      draft.gmailDraftId = gmailDraftId.trim() || undefined;
      job.updatedAt = new Date().toISOString();
      await persistJobs();
      return clone(draft);
    }

    return undefined;
  });
}

export async function saveJobAnalysis(
  userId: string,
  jobId: string,
  analysis: JobAnalysis,
  fitScore?: number | null,
): Promise<JobRecord | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.saveJobAnalysis(userId, jobId, analysis, fitScore);
  }

  return runExclusive(async () => {
    const jobs = await ensureLoaded();
    const job = jobs.find((entry) => entry.id === jobId && entry.userId === userId);

    if (!job) {
      return undefined;
    }

    if (!validateJobAnalysis(analysis)) {
      throw new Error('Invalid job analysis payload');
    }

    job.analysis = clone(analysis);
    if (fitScore !== undefined) {
      job.fitScore = fitScore;
    }
    job.updatedAt = new Date().toISOString();
    await persistJobs();
    return clone(job);
  });
}

export async function clearUserData(userId: string): Promise<void> {
  if (hasPostgresConnection()) {
    return postgresStore.clearUserData(userId);
  }

  await runExclusive(async () => {
    const jobs = await ensureLoaded();
    jobsCache = jobs.filter((entry) => entry.userId !== userId);
    await persistJobs();
  });
}

export async function seedDemoData(userId: string): Promise<void> {
  if (hasPostgresConnection()) {
    return postgresStore.seedDemoData(userId);
  }

  await runExclusive(async () => {
    const jobs = await ensureLoaded();
    const others = jobs.filter((entry) => entry.userId !== userId);
    const mine = clone(seedJobs).map((job) => ({
      ...job,
      id: randomUUID(),
      userId,
      outreach: job.outreach.map((draft) => ({ ...draft, id: randomUUID() })),
    }));
    jobsCache = [...mine, ...others];
    await persistJobs();
  });
}
