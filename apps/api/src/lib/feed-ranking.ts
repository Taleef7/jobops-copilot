import type {
  FeedItem,
  FeedQueryOptions,
  FeedResult,
  JobRecord,
  JobStatusEvent,
} from '@/types';

/** Common short technical keywords that should be treated as meaningful tokens */
const SHORT_TOKENS = new Set(['ai', 'ml', 'qa', 'ui', 'ux', 'sre', 'dev']);

/**
 * Tokenize a role title into normalized keywords for title-family matching.
 */
export function extractTitleTokens(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 || SHORT_TOKENS.has(w));
  return new Set(words);
}

export interface OutcomeFeedbackStats {
  companyInterviewCounts: Map<string, number>;
  companyOutrightRejectedCounts: Map<string, number>;
  successfulTitleTokens: Set<string>;
}

/**
 * Derive per-company and per-title-family outcome statistics from pipeline history.
 * Distinguishes "interviewed then rejected" from "rejected outright".
 */
export function buildOutcomeStats(
  jobs: JobRecord[],
  events: JobStatusEvent[] = [],
): OutcomeFeedbackStats {
  const companyInterviewCounts = new Map<string, number>();
  const companyOutrightRejectedCounts = new Map<string, number>();
  const successfulTitleTokens = new Set<string>();

  // Map of jobId -> whether it ever reached interview or offer
  const jobReachedInterview = new Map<string, boolean>();

  // 1. Process explicit status events if available
  for (const event of events) {
    if (event.toStatus === 'interview' || event.toStatus === 'offer') {
      jobReachedInterview.set(event.jobId, true);
    }
  }

  // 2. Also check current status on jobs (e.g. if currently in interview or offer)
  for (const job of jobs) {
    if (job.status === 'interview' || job.status === 'offer') {
      jobReachedInterview.set(job.id, true);
    }
  }

  // 3. Build company outcome counts and successful title tokens
  for (const job of jobs) {
    const normCompany = job.company.trim().toLowerCase();
    const reachedInterview = jobReachedInterview.get(job.id) ?? false;

    if (reachedInterview) {
      companyInterviewCounts.set(normCompany, (companyInterviewCounts.get(normCompany) ?? 0) + 1);
      for (const token of extractTitleTokens(job.title)) {
        successfulTitleTokens.add(token);
      }
    } else if (job.status === 'rejected') {
      // Outright rejection with no interview
      companyOutrightRejectedCounts.set(
        normCompany,
        (companyOutrightRejectedCounts.get(normCompany) ?? 0) + 1,
      );
    }
  }

  return {
    companyInterviewCounts,
    companyOutrightRejectedCounts,
    successfulTitleTokens,
  };
}

/**
 * Score and rank jobs using outcome feedback heuristics and freshness signals.
 */
export function rankFeedJobs(
  jobs: JobRecord[],
  stats: OutcomeFeedbackStats,
  options: FeedQueryOptions = {},
  now = Date.now(),
): FeedResult {
  const MS_PER_HOUR = 3600 * 1000;

  const items: FeedItem[] = [];

  for (const job of jobs) {
    // 1. Filter by status (default: omit archived)
    if (options.status) {
      if (job.status !== options.status) continue;
    } else if (job.status === 'archived') {
      continue;
    }

    // 2. Filter by seniority
    if (options.seniority && job.seniority !== options.seniority) {
      continue;
    }

    // 3. Filter by workplace type
    if (options.workplaceType && job.workplaceType !== options.workplaceType) {
      continue;
    }

    // 4. Filter by sponsorship
    if (options.sponsorOnly) {
      const isLikely =
        job.sponsorLikelihood === 'likely' ||
        job.sponsorLikelihood === 'possible' ||
        (typeof job.sponsorLikelihood === 'object' && job.sponsorLikelihood !== null);
      if (!isLikely) continue;
    }

    const normCompany = job.company.trim().toLowerCase();
    const rawSignals = job.analysis?.subSignals;
    const subSignals = {
      skillsMatch: typeof rawSignals?.skillsMatch === 'number' ? rawSignals.skillsMatch : 50,
      titleSeniority: typeof rawSignals?.titleSeniority === 'number' ? rawSignals.titleSeniority : 50,
      salaryFit: typeof rawSignals?.salaryFit === 'number' ? rawSignals.salaryFit : 50,
      sponsorshipLikelihood:
        typeof rawSignals?.sponsorshipLikelihood === 'number' ? rawSignals.sponsorshipLikelihood : 50,
    };

    let baseScore = job.fitScore;
    if (baseScore === null || typeof baseScore === 'undefined') {
      baseScore = subSignals.skillsMatch ?? 50;
    }

    const rankReasons: string[] = [];
    let delta = 0;

    // Outcome feedback: company history
    const interviews = stats.companyInterviewCounts.get(normCompany) ?? 0;
    const rejections = stats.companyOutrightRejectedCounts.get(normCompany) ?? 0;

    if (interviews > 0) {
      delta += 10;
      rankReasons.push(`Proven interview track record at ${job.company} (+10)`);
    } else if (rejections >= 2) {
      delta -= 15;
      rankReasons.push(`Multiple previous rejections without interview at ${job.company} (-15)`);
    }

    // Outcome feedback: title family match
    const titleTokens = extractTitleTokens(job.title);
    let matchedTitleToken = false;
    for (const token of titleTokens) {
      if (stats.successfulTitleTokens.has(token)) {
        matchedTitleToken = true;
        break;
      }
    }
    if (matchedTitleToken) {
      delta += 8;
      rankReasons.push('Target role aligns with previous interview success (+8)');
    }

    // Sub-signals match highlights
    if (typeof subSignals.skillsMatch === 'number' && subSignals.skillsMatch >= 85) {
      rankReasons.push(`Strong skills overlap (${subSignals.skillsMatch}%)`);
    }
    if (typeof subSignals.salaryFit === 'number' && subSignals.salaryFit >= 80) {
      rankReasons.push('Strong compensation alignment');
    }
    if (
      job.sponsorLikelihood === 'likely' ||
      (typeof job.sponsorLikelihood === 'object' && job.sponsorLikelihood !== null)
    ) {
      rankReasons.push('High visa sponsorship probability');
    }

    // Freshness & liveness adjustments
    const discoveredTime = job.discoveredAt ? Date.parse(job.discoveredAt) : Date.parse(job.createdAt);
    const ageHours = !Number.isNaN(discoveredTime) ? (now - discoveredTime) / MS_PER_HOUR : 999;

    if (ageHours <= 24) {
      delta += 5;
      rankReasons.push('Fresh listing (discovered < 24h ago)');
    } else if (ageHours <= 72) {
      delta += 2;
    }

    if (job.liveness === 'stale') {
      delta -= 10;
      rankReasons.push('Listing may be stale (-10)');
    } else if (job.liveness === 'expired') {
      delta -= 30;
      rankReasons.push('Posting likely expired or closed (-30)');
    }

    const adjustedScore = Math.max(0, Math.min(100, Math.round(baseScore + delta)));

    // Minimum score filter
    if (typeof options.minScore === 'number' && adjustedScore < options.minScore) {
      continue;
    }

    items.push({
      job,
      fitScore: job.fitScore,
      adjustedScore,
      subSignals,
      rankReasons,
    });
  }

  // Sort descending by adjustedScore, then datePosted / discoveredAt
  items.sort((a, b) => {
    const scoreDiff = (b.adjustedScore ?? 0) - (a.adjustedScore ?? 0);
    if (scoreDiff !== 0) return scoreDiff;

    const timeB = Date.parse(b.job.datePosted ?? b.job.discoveredAt ?? b.job.createdAt) || 0;
    const timeA = Date.parse(a.job.datePosted ?? a.job.discoveredAt ?? a.job.createdAt) || 0;
    return timeB - timeA;
  });

  const total = items.length;
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, Math.min(100, options.limit ?? 20));
  const paginated = items.slice(offset, offset + limit);

  return {
    items: paginated,
    total,
    limit,
    offset,
  };
}
