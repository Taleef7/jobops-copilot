import {
  createJob as createJobStore,
  listJobs as listJobsStore,
  saveJobAnalysis as saveJobAnalysisStore,
} from '@/data/job-store';
import { listSavedSearches as listSavedSearchesStore } from '@/data/saved-search-store';
import { prerankAnalysis } from '@/lib/local-fit';
import { analysisFromFit, type FitScoreOutput } from '@/lib/analysis-core';
import type { JobSource } from '@/lib/job-sources';
import { dedupKey, fingerprintKey, type SourcedJob } from '@/lib/job-sources/normalize';
import { fetchTargetCompanyBoards } from '@/lib/job-sources/boards';
import { FULL_JD_MIN_CHARS, type upgradeToFullJd } from '@/lib/jd-upgrade';
import type { SponsorLikelihood, TargetCompany } from '@/types';

export interface DiscoveryResult {
  inserted: number;
  skipped: number;
  source: string;
}

export interface DiscoveryDeps {
  source?: JobSource;
  sources?: JobSource[];
  listJobs: typeof listJobsStore;
  createJob: typeof createJobStore;
  listSavedSearches: typeof listSavedSearchesStore;
  getResume: (userId: string) => Promise<string>;
  getProfile?: (userId: string) => Promise<{ resumeText?: string; profileText?: string } | undefined>;
  saveAnalysis: typeof saveJobAnalysisStore;
  listTargetCompanies?: (userId: string) => Promise<TargetCompany[]>;
  fetchBoards?: typeof fetchTargetCompanyBoards;
  lookupSponsor?: (company: string) => Promise<SponsorLikelihood | null>;
  upgradeJd?: typeof upgradeToFullJd;
  touchSeen?: (userId: string, jobIds: string[]) => Promise<void>;
  resolveFitScore?: (input: {
    userId?: string;
    descriptionText: string;
    resumeText: string;
    profileText: string;
    title?: string | null;
  }) => Promise<FitScoreOutput>;
  reserveBudget?: (userId: string, op: string) => Promise<boolean>;
}

/**
 * Every dedup key a job occupies: its URL key (when present) *and* its
 * `company|title|location` fingerprint. Recording both for stored jobs lets a
 * URL-backed posting collide with a URL-less copy of the same posting (e.g. a
 * manually tracked job vs. a source row that omits the URL).
 */
function keysFor(job: { jobUrl?: string; company?: string; title?: string; location?: string }): string[] {
  const fingerprint = fingerprintKey(job);
  return job.jobUrl ? [job.jobUrl.toLowerCase(), fingerprint] : [fingerprint];
}

/**
 * Postgres unique-violation — a concurrent run already inserted this posting.
 * Safe to treat as a duplicate because `jobs_user_job_url_unique_idx`
 * (the per-user `(user_id, job_url)` index) is the only raisable unique
 * constraint in `createJob`'s transaction; `job_analysis` uses
 * `on conflict do update`. Revisit this if another unique index is added to
 * either table, or a real conflict would be silently counted as skipped.
 */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
  );
}

/**
 * Run every saved search for a user against the active job source and insert the
 * new postings into their CRM, skipping duplicates (of existing jobs and within
 * the run). A single failing search is skipped rather than aborting the run.
 */
export async function runDiscoveryForUser(userId: string, deps: DiscoveryDeps): Promise<DiscoveryResult> {
  const JD_FETCH_CAP = Number(process.env.DISCOVERY_JD_FETCH_CAP ?? 25);
  const JD_UPGRADE_TIME_BUDGET_MS = Number(process.env.DISCOVERY_JD_UPGRADE_BUDGET_MS ?? 15_000);
  const jdUpgradeDeadline = Date.now() + JD_UPGRADE_TIME_BUDGET_MS;
  const AI_SCORE_TIME_BUDGET_MS = Number(process.env.DISCOVERY_AI_SCORE_BUDGET_MS ?? 30_000);
  const AI_SCORE_PER_JOB_TIMEOUT_MS = Number(process.env.DISCOVERY_AI_SCORE_TIMEOUT_MS ?? 10_000);
  const aiScoreDeadline = Date.now() + AI_SCORE_TIME_BUDGET_MS;
  const searches = await deps.listSavedSearches(userId);
  const existingJobs = await deps.listJobs(userId);
  const seen = new Set(existingJobs.flatMap(keysFor));
  const existingJobIdByKey = new Map<string, string>();
  for (const job of existingJobs) {
    for (const k of keysFor(job)) {
      existingJobIdByKey.set(k, job.id);
    }
  }
  const reSeenJobIds = new Set<string>();
  const resume = await deps.getResume(userId);
  const profile = deps.getProfile ? await deps.getProfile(userId) : undefined;
  const profileText = profile?.profileText || resume;

  const sources: JobSource[] = deps.sources && deps.sources.length > 0
    ? deps.sources
    : deps.source
      ? [deps.source]
      : [];

  let inserted = 0;
  let skipped = 0;
  let jdFetchAttempts = 0;
  const contributingSources = new Set<string>();

  async function insertIfNew(job: SourcedJob): Promise<void> {
    const key = dedupKey(job);
    if (seen.has(key)) {
      const existingId = existingJobIdByKey.get(key);
      if (existingId) {
        reSeenJobIds.add(existingId);
      }
      skipped += 1;
      return;
    }
    // Reserve every key this posting occupies so a later URL-less/URL-backed
    // copy in the same run is recognised as a duplicate.
    for (const k of keysFor(job)) seen.add(k);
    try {
      const currentDesc = job.descriptionText ?? '';
      const remainingBudgetMs = jdUpgradeDeadline - Date.now();
      if (
        deps.upgradeJd &&
        job.jobUrl &&
        currentDesc.length < FULL_JD_MIN_CHARS &&
        jdFetchAttempts < JD_FETCH_CAP &&
        remainingBudgetMs > 500
      ) {
        jdFetchAttempts += 1;
        const { job: upgraded } = await deps.upgradeJd(job, {}, {
          timeoutMs: Math.min(8_000, remainingBudgetMs),
        });
        job = upgraded;
      }

      const sponsor = deps.lookupSponsor ? await deps.lookupSponsor(job.company) : null;
      const createdJob = await deps.createJob(userId, {
        ...job,
        sponsorLikelihood: sponsor ?? job.sponsorLikelihood,
      });
      inserted += 1;
      // Sequential scoring: attempt AI scoring if enabled and budget allows;
      // otherwise fall back gracefully to local pre-ranking.
      let scoredWithAi = false;
      const remainingAiScoreBudgetMs = aiScoreDeadline - Date.now();
      if (resume && deps.resolveFitScore && deps.reserveBudget && remainingAiScoreBudgetMs > 1_000) {
        try {
          const budgetAllowed = await deps.reserveBudget(userId, 'score');
          if (budgetAllowed) {
            const timeoutMs = Math.min(remainingAiScoreBudgetMs, AI_SCORE_PER_JOB_TIMEOUT_MS);
            let timerId: NodeJS.Timeout | undefined;
            const timeoutPromise = new Promise<never>((_, reject) => {
              timerId = setTimeout(() => reject(new Error('AI scoring per-job timeout exceeded')), timeoutMs);
            });

            try {
              const fit = await Promise.race([
                deps.resolveFitScore({
                  userId,
                  descriptionText: createdJob.descriptionText,
                  resumeText: resume,
                  profileText,
                  title: createdJob.title,
                }),
                timeoutPromise,
              ]);
              const analysis = analysisFromFit(fit, {
                requiredSkills: fit.ats_keywords?.slice(0, 5) ?? [],
                preferredSkills: fit.ats_keywords?.slice(5, 8) ?? [],
              });
              await deps.saveAnalysis(userId, createdJob.id, analysis, fit.fit_score);
              scoredWithAi = true;
            } finally {
              if (timerId) clearTimeout(timerId);
            }
          }
        } catch {
          // AI scoring failed or timed out; fall through to local prerank
        }
      }

      if (!scoredWithAi) {
        try {
          const { fitScore, analysis } = prerankAnalysis(job.descriptionText ?? '', resume);
          await deps.saveAnalysis(userId, createdJob.id, analysis, fitScore);
        } catch {
          // Leave the job unranked rather than failing the discovery run.
        }
      }
    } catch (error) {
      // A concurrent discovery run (manual click + n8n sweep, or two API
      // instances) can insert the same posting between building `seen` and
      // this insert; Postgres' per-user (user_id, job_url) unique index then
      // rejects it. Count the race as a skip instead of failing the request.
      if (isDuplicateKeyError(error)) {
        skipped += 1;
        return;
      }
      throw error;
    }
  }

  for (const search of searches) {
    for (const src of sources) {
      let found: SourcedJob[];
      try {
        found = await src.search(search.query, {
          location: search.location,
          remoteOnly: search.remoteOnly,
          limit: 20,
        });
        contributingSources.add(src.name);
      } catch {
        continue;
      }

      for (const job of found) {
        await insertIfNew(job);
      }
    }
  }

  const targets = deps.listTargetCompanies ? await deps.listTargetCompanies(userId) : [];
  if (targets?.some((t) => t.enabled)) {
    const fetchBoards = deps.fetchBoards ?? fetchTargetCompanyBoards;
    const boardJobs = await fetchBoards(targets);
    for (const job of boardJobs) {
      await insertIfNew(job);
    }
  }

  const boardSources = Array.from(new Set(targets.filter((t) => t.enabled).map((t) => t.boardType))).sort();
  const searchSourceList = contributingSources.size > 0
    ? Array.from(contributingSources)
    : sources.map((s) => s.name);
  const combined = [...searchSourceList, ...boardSources];
  const source = combined.length > 0 ? combined.join('+') : 'unknown';

  if (reSeenJobIds.size > 0 && deps.touchSeen) {
    try {
      await deps.touchSeen(userId, [...reSeenJobIds]);
    } catch {
      // Ignore error
    }
  }

  return { inserted, skipped, source };
}
