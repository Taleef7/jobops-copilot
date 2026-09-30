import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CreateJobBody,
  FeedQueryOptions,
  FeedResult,
  JobAnalysis,
  JobRecord,
  JobStatusEvent,
  OutreachDraft,
  TrackedJobRef,
  UpdateOutreachBody,
  UpdateJobBody,
} from '@/types';
import { validateJobAnalysis } from '@/lib/analysis-core';
import { deriveAnalyzedNextAction, UNSCORED_NEXT_ACTION } from '@/lib/analysis-workflow';
import { deriveOutreachJobUpdate } from '@/lib/outreach-workflow';
import { hasPostgresConnection } from '@/lib/postgres';
import { paginateArray, type PageParams } from '@/lib/pagination';
import * as postgresStore from '@/data/job-store.postgres';
import { seedJobs } from '@/data/mock-store';
import { computeContentHash, parseSalaryFromText, parseSeniority } from '@/lib/job-enrich';
import { canonicalJobUrl } from '@/lib/job-sources/normalize';
import { buildOutcomeStats, rankFeedJobs } from '@/lib/feed-ranking';
import { deleteResumeVersions } from '@/data/resume-version-store';
import { JOB_FIELD_MAX, JOB_NOTE_MAX, STORED_TEXT_MAX } from '@/lib/input-caps';

// Resolved per call (not once at import) so tests can redirect the store with chdir.
function dataDir() {
  return join(process.cwd(), 'data');
}

function dataFile() {
  return join(dataDir(), 'jobs.json');
}

function statusEventsFile() {
  return join(dataDir(), 'job-status-events.json');
}

let jobsCache: JobRecord[] | null = null;
let loadPromise: Promise<JobRecord[]> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();
let statusEventsCache: JobStatusEvent[] | null = null;
let statusEventsLoadPromise: Promise<JobStatusEvent[]> | null = null;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createBaseJob(userId: string, body: CreateJobBody): JobRecord {
  const timestamp = new Date().toISOString();
  const parsedSalary =
    body.salaryMin == null && body.salaryMax == null
      ? parseSalaryFromText(body.descriptionText)
      : null;
  const salaryMin = body.salaryMin ?? parsedSalary?.min ?? null;
  const salaryMax = body.salaryMax ?? parsedSalary?.max ?? null;
  const salaryCurrency = body.salaryCurrency ?? (parsedSalary ? parsedSalary.currency : null);
  const seniority = body.seniority ?? parseSeniority(body.title, body.descriptionText);
  const contentHash =
    body.contentHash ??
    computeContentHash({
      company: body.company,
      title: body.title,
      descriptionText: body.descriptionText,
    });
  const lastSeenAt = body.lastSeenAt ?? timestamp;
  const liveness = body.liveness ?? 'active';
  const sponsorLikelihood = body.sponsorLikelihood ?? null;

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
    status: body.status ?? 'discovered',
    priority: body.priority ?? 'medium',
    fitScore: null,
    notes: body.notes?.trim() || undefined,
    nextAction: body.nextAction ?? UNSCORED_NEXT_ACTION,
    nextActionDue: undefined,
    // No analysis until a real fit score succeeds (#349).
    analysis: null,
    outreach: [],
    salaryMin,
    salaryMax,
    salaryCurrency,
    seniority,
    sponsorLikelihood,
    contentHash,
    lastSeenAt,
    liveness,
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
  await mkdir(dataDir(), { recursive: true });

  try {
    const raw = await readFile(dataFile(), 'utf8');
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

  await mkdir(dataDir(), { recursive: true });
  await writeFile(dataFile(), `${JSON.stringify(jobsCache, null, 2)}\n`, 'utf8');
}

async function loadStatusEvents(): Promise<JobStatusEvent[]> {
  await mkdir(dataDir(), { recursive: true });

  try {
    const raw = await readFile(statusEventsFile(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error('Invalid status events store contents');
    }

    statusEventsCache = parsed as JobStatusEvent[];
  } catch {
    statusEventsCache = [];
    await persistStatusEvents();
  }

  return statusEventsCache;
}

async function ensureStatusEventsLoaded(): Promise<JobStatusEvent[]> {
  if (statusEventsCache) {
    return statusEventsCache;
  }

  statusEventsLoadPromise ??= loadStatusEvents();
  return statusEventsLoadPromise;
}

async function persistStatusEvents() {
  if (!statusEventsCache) {
    return;
  }

  await mkdir(dataDir(), { recursive: true });
  await writeFile(statusEventsFile(), `${JSON.stringify(statusEventsCache, null, 2)}\n`, 'utf8');
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

export async function listJobs(userId: string, page?: PageParams): Promise<JobRecord[]> {
  if (hasPostgresConnection()) {
    return postgresStore.listJobs(userId, page);
  }

  const jobs = await ensureLoaded();
  const mine = clone(jobs.filter((entry) => entry.userId === userId));
  return page ? paginateArray(mine, page) : mine;
}

export async function countJobs(userId: string): Promise<number> {
  if (hasPostgresConnection()) {
    return postgresStore.countJobs(userId);
  }

  const jobs = await ensureLoaded();
  return jobs.filter((entry) => entry.userId === userId).length;
}

/** The user's job for this posting, reached through any of its URLs (#346). */
export async function findJobByCanonicalUrl(userId: string, jobUrl: string): Promise<TrackedJobRef | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.findJobByCanonicalUrl(userId, jobUrl);
  }

  const key = canonicalJobUrl(jobUrl);
  const jobs = await ensureLoaded();
  const job = jobs.find((entry) => entry.userId === userId && entry.jobUrl && canonicalJobUrl(entry.jobUrl) === key);
  return job ? { id: job.id, company: job.company, title: job.title } : undefined;
}

/** Fill canonical URLs stored before migration 026 (Postgres only; file mode computes them on read). */
export async function backfillCanonicalUrls(): Promise<number> {
  return hasPostgresConnection() ? postgresStore.backfillCanonicalUrls() : 0;
}

export async function getJobById(userId: string, jobId: string): Promise<JobRecord | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.getJobById(userId, jobId);
  }

  const jobs = await ensureLoaded();
  const job = jobs.find((entry) => entry.id === jobId && entry.userId === userId);
  return job ? clone(job) : undefined;
}

/**
 * Bound stored text for every writer (#345). POST /api/jobs refuses over-long text with a
 * 413; discovery and the n8n intake call createJob directly, so their text is cut here.
 */
function boundedJobBody(body: CreateJobBody): CreateJobBody {
  const cut = (value: string | undefined, max: number) =>
    typeof value === 'string' && value.length > max ? value.slice(0, max) : value;
  return {
    ...body,
    company: cut(body.company, JOB_FIELD_MAX)!,
    title: cut(body.title, JOB_FIELD_MAX)!,
    descriptionText: cut(body.descriptionText, STORED_TEXT_MAX)!,
    notes: cut(body.notes, JOB_NOTE_MAX),
    nextAction: cut(body.nextAction, JOB_NOTE_MAX),
  };
}

export async function createJob(userId: string, rawBody: CreateJobBody): Promise<JobRecord> {
  const body = boundedJobBody(rawBody);
  if (hasPostgresConnection()) {
    return postgresStore.createJob(userId, body);
  }

  return runExclusive(async () => {
    const jobs = await ensureLoaded();
    const job = createBaseJob(userId, body);
    const events = await ensureStatusEventsLoaded();
    events.push({
      id: randomUUID(),
      jobId: job.id,
      userId,
      fromStatus: null,
      toStatus: job.status,
      createdAt: job.updatedAt,
    });
    await persistStatusEvents();
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

    if (typeof body.status !== 'undefined' && body.status !== job.status) {
      const events = await ensureStatusEventsLoaded();
      events.push({
        id: randomUUID(),
        jobId: job.id,
        userId,
        fromStatus: job.status,
        toStatus: body.status,
        createdAt: new Date().toISOString(),
      });
      await persistStatusEvents();
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
    // Replace only the superseded unsent draft; preserve approved/sent/skipped
    // rows, which carry real outreach history and dashboard/reporting state.
    const preserved = job.outreach.filter((entry) => entry.status !== 'drafted');
    job.outreach = [...preserved, clonedDraft];
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

export async function getOutreachDraft(
  userId: string,
  outreachId: string,
): Promise<{ draft: OutreachDraft; job: JobRecord } | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.getOutreachDraft(userId, outreachId);
  }

  return runExclusive(async () => {
    const jobs = await ensureLoaded();

    for (const job of jobs) {
      if (job.userId !== userId) {
        continue;
      }

      const draft = job.outreach.find((entry) => entry.id === outreachId);
      if (draft) {
        return { draft: clone(draft), job: clone(job) };
      }
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
    // A scored job must stop telling you to score it. Null means "leave it" —
    // a pre-rank, or a next action that is no longer the creation-time prompt.
    const nextAction = deriveAnalyzedNextAction(job.nextAction, analysis.modelUsed, fitScore);
    if (nextAction) {
      job.nextAction = nextAction;
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

    const events = await ensureStatusEventsLoaded();
    statusEventsCache = events.filter((entry) => entry.userId !== userId);
    await persistStatusEvents();

    await deleteResumeVersions(userId);
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

    const events = await ensureStatusEventsLoaded();
    statusEventsCache = events.filter((entry) => entry.userId !== userId);
    await persistStatusEvents();
  });
}

export async function touchJobsSeen(userId: string, jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) {
    return;
  }
  if (hasPostgresConnection()) {
    return postgresStore.touchJobsSeen(userId, jobIds);
  }

  await runExclusive(async () => {
    const jobs = await ensureLoaded();
    const idSet = new Set(jobIds);
    const now = new Date().toISOString();
    let changed = false;
    for (const job of jobs) {
      if (job.userId === userId && idSet.has(job.id)) {
        job.lastSeenAt = now;
        job.liveness = 'active';
        changed = true;
      }
    }
    if (changed) {
      await persistJobs();
    }
  });
}

export async function getJobStatusEvents(userId: string): Promise<JobStatusEvent[]> {
  if (hasPostgresConnection()) {
    return postgresStore.getJobStatusEvents(userId);
  }
  const events = await ensureStatusEventsLoaded();
  return clone(events.filter((entry) => entry.userId === userId));
}

export async function getRankedFeed(
  userId: string,
  options: FeedQueryOptions = {},
): Promise<FeedResult> {
  if (hasPostgresConnection()) {
    return postgresStore.getRankedFeed(userId, options);
  }
  const [jobs, events] = await Promise.all([listJobs(userId), getJobStatusEvents(userId)]);
  const stats = buildOutcomeStats(jobs, events);
  return rankFeedJobs(jobs, stats, options);
}

export function resetJobStoreForTests() {
  jobsCache = null;
  loadPromise = null;
  mutationQueue = Promise.resolve();
  statusEventsCache = null;
  statusEventsLoadPromise = null;
}
