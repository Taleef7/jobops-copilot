import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CreateJobBody,
  JobAnalysis,
  JobRecord,
  OutreachDraft,
  UpdateJobBody,
} from '@/types';
import { validateJobAnalysis } from '@/lib/analysis-core';
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

function createBaseJob(body: CreateJobBody): JobRecord {
  const timestamp = new Date().toISOString();

  return {
    id: randomUUID(),
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
    nextAction: 'Run AI parsing and fit scoring after the record is saved.',
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

export async function listJobs(): Promise<JobRecord[]> {
  if (hasPostgresConnection()) {
    return postgresStore.listJobs();
  }

  const jobs = await ensureLoaded();
  return clone(jobs);
}

export async function getJobById(jobId: string): Promise<JobRecord | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.getJobById(jobId);
  }

  const jobs = await ensureLoaded();
  const job = jobs.find((entry) => entry.id === jobId);
  return job ? clone(job) : undefined;
}

export async function createJob(body: CreateJobBody): Promise<JobRecord> {
  if (hasPostgresConnection()) {
    return postgresStore.createJob(body);
  }

  return runExclusive(async () => {
    const jobs = await ensureLoaded();
    const job = createBaseJob(body);
    jobs.unshift(job);
    await persistJobs();
    return clone(job);
  });
}

export async function updateJob(jobId: string, body: UpdateJobBody): Promise<JobRecord | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.updateJob(jobId, body);
  }

  return runExclusive(async () => {
    const jobs = await ensureLoaded();
    const job = jobs.find((entry) => entry.id === jobId);

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

export async function appendOutreachDraft(jobId: string, draft: OutreachDraft): Promise<OutreachDraft | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.appendOutreachDraft(jobId, draft);
  }

  return runExclusive(async () => {
    const jobs = await ensureLoaded();
    const job = jobs.find((entry) => entry.id === jobId);

    if (!job) {
      return undefined;
    }

    const clonedDraft = clone(draft);
    job.outreach.push(clonedDraft);
    job.updatedAt = new Date().toISOString();
    await persistJobs();
    return clone(clonedDraft);
  });
}

export async function saveJobAnalysis(
  jobId: string,
  analysis: JobAnalysis,
  fitScore?: number | null,
): Promise<JobRecord | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.saveJobAnalysis(jobId, analysis, fitScore);
  }

  return runExclusive(async () => {
    const jobs = await ensureLoaded();
    const job = jobs.find((entry) => entry.id === jobId);

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
