import { randomUUID } from 'node:crypto';
import type {
  CreateJobBody,
  FeedQueryOptions,
  FeedResult,
  JobAnalysis,
  JobRecord,
  JobStatus,
  JobStatusEvent,
  OutreachDraft,
  TrackedJobRef,
  UpdateJobBody,
  UpdateOutreachBody,
} from '@/types';
import { validateJobAnalysis } from '@/lib/analysis-core';
import { deriveAnalyzedNextAction, UNSCORED_NEXT_ACTION } from '@/lib/analysis-workflow';
import { getPool } from '@/lib/postgres';
import type { PageParams } from '@/lib/pagination';
import { deriveOutreachJobUpdate } from '@/lib/outreach-workflow';
import { seedJobs } from '@/data/mock-store';
import { computeContentHash, parseSalaryFromText, parseSeniority } from '@/lib/job-enrich';
import { canonicalJobUrl } from '@/lib/job-sources/normalize';
import { DuplicateJobError } from './duplicate-job';
import { buildOutcomeStats, rankFeedJobs } from '@/lib/feed-ranking';

type JobRow = {
  id: string;
  job_url: string | null;
  source: string;
  company: string;
  title: string;
  location: string | null;
  employment_type: string | null;
  workplace_type: string | null;
  date_posted: string | null;
  discovered_at: string;
  description_text: string;
  status: string;
  priority: string;
  fit_score: number | null;
  notes: string | null;
  next_action: string | null;
  next_action_due: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  seniority: string | null;
  sponsor_likelihood: string | null;
  content_hash: string | null;
  last_seen_at: string | null;
  liveness: string;
  created_at: string;
  updated_at: string;
};

type JobAnalysisRow = {
  job_id: string;
  required_skills: unknown;
  preferred_skills: unknown;
  matched_skills: unknown;
  missing_skills: unknown;
  ats_keywords: unknown;
  fit_summary: string;
  recommended_resume_angle: string;
  apply_recommendation: string;
  confidence_score: number | null;
  model_used: string;
  sub_signals?: unknown;
  created_at: string;
};

type OutreachRow = {
  id: string;
  job_id: string;
  contact_name: string | null;
  contact_role: string | null;
  contact_source: string | null;
  linkedin_url: string | null;
  email: string | null;
  message_type: string;
  draft_text: string;
  status: string;
  gmail_draft_id: string | null;
  created_at: string;
  sent_at: string | null;
  follow_up_due: string | null;
};

type JobStateRow = {
  status: string;
  next_action: string | null;
};

function poolOrThrow() {
  const pool = getPool();

  if (!pool) {
    throw new Error('Postgres is not configured. Set DATABASE_URL to enable the database-backed store.');
  }

  return pool;
}

function toIsoString(value: string | Date | null | undefined) {
  if (!value) {
    return undefined;
  }

  return new Date(value).toISOString();
}

function toTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

/** The job's analysis, or null when it has none yet (#349: no made-up default). */
function mapAnalysis(row: JobAnalysisRow | undefined): JobAnalysis | null {
  if (!row) {
    return null;
  }

  const subSignals =
    row.sub_signals && typeof row.sub_signals === 'object' && !Array.isArray(row.sub_signals)
      ? (row.sub_signals as JobAnalysis['subSignals'])
      : undefined;

  const analysis = {
    requiredSkills: toTextArray(row.required_skills),
    preferredSkills: toTextArray(row.preferred_skills),
    matchedSkills: toTextArray(row.matched_skills),
    missingSkills: toTextArray(row.missing_skills),
    atsKeywords: toTextArray(row.ats_keywords),
    fitSummary: row.fit_summary,
    recommendedResumeAngle: row.recommended_resume_angle,
    applyRecommendation: row.apply_recommendation,
    confidenceScore: row.confidence_score ?? null,
    modelUsed: row.model_used,
    subSignals,
  } satisfies JobAnalysis;

  return validateJobAnalysis(analysis) ? analysis : null;
}

function mapOutreach(row: OutreachRow): OutreachDraft {
  return {
    id: row.id,
    jobId: row.job_id,
    contactName: row.contact_name ?? undefined,
    contactRole: row.contact_role ?? undefined,
    contactSource: row.contact_source ?? undefined,
    linkedinUrl: row.linkedin_url ?? undefined,
    email: row.email ?? undefined,
    gmailDraftId: row.gmail_draft_id ?? undefined,
    messageType: row.message_type as OutreachDraft['messageType'],
    draftText: row.draft_text,
    status: row.status as OutreachDraft['status'],
    createdAt: toIsoString(row.created_at) ?? row.created_at,
    sentAt: toIsoString(row.sent_at),
    followUpDue: toIsoString(row.follow_up_due),
  };
}

function parseSponsorLikelihood(raw: string | null): JobRecord['sponsorLikelihood'] {
  if (!raw) return null;
  if (raw.startsWith('{')) {
    try {
      return JSON.parse(raw) as JobRecord['sponsorLikelihood'];
    } catch {
      return raw as JobRecord['sponsorLikelihood'];
    }
  }
  return raw as JobRecord['sponsorLikelihood'];
}

function mapJob(row: JobRow, analysisRow?: JobAnalysisRow, outreachRows: OutreachRow[] = []): JobRecord {
  return {
    id: row.id,
    jobUrl: row.job_url ?? undefined,
    source: row.source,
    company: row.company,
    title: row.title,
    location: row.location ?? 'Remote',
    employmentType: row.employment_type ?? 'Full-time',
    workplaceType: (row.workplace_type ?? 'remote') as JobRecord['workplaceType'],
    datePosted: toIsoString(row.date_posted),
    discoveredAt: toIsoString(row.discovered_at) ?? row.discovered_at,
    descriptionText: row.description_text,
    status: row.status as JobRecord['status'],
    priority: row.priority as JobRecord['priority'],
    fitScore: row.fit_score,
    notes: row.notes ?? undefined,
    nextAction: row.next_action ?? 'Review the job and decide on the next step.',
    nextActionDue: toIsoString(row.next_action_due),
    analysis: mapAnalysis(analysisRow),
    outreach: outreachRows.map(mapOutreach),
    salaryMin: row.salary_min ?? null,
    salaryMax: row.salary_max ?? null,
    salaryCurrency: row.salary_currency ?? null,
    seniority: (row.seniority as JobRecord['seniority']) ?? undefined,
    sponsorLikelihood: parseSponsorLikelihood(row.sponsor_likelihood),
    contentHash: row.content_hash ?? null,
    lastSeenAt: toIsoString(row.last_seen_at),
    liveness: (row.liveness as JobRecord['liveness']) ?? 'active',
    createdAt: toIsoString(row.created_at) ?? row.created_at,
    updatedAt: toIsoString(row.updated_at) ?? row.updated_at,
  };
}

export async function listJobs(userId: string, page?: PageParams): Promise<JobRecord[]> {
  const pool = poolOrThrow();

  // Paginate the base jobs query; the analysis/outreach fan-out below then scopes
  // to only the page's job ids, so a page never over-fetches the nested rows.
  const params: unknown[] = [userId];
  // `id` tie-breaks equal created_at (concurrent creates) so LIMIT/OFFSET pages are
  // stable — without it a client can see a job twice or miss one across pages.
  let sql = 'select * from jobs where user_id = $1 order by created_at desc, id desc';
  if (page?.limit !== undefined) {
    params.push(page.limit);
    sql += ` limit $${params.length}`;
  }
  if (page && page.offset > 0) {
    params.push(page.offset);
    sql += ` offset $${params.length}`;
  }

  const jobsResult = await pool.query<JobRow>(sql, params);
  if (jobsResult.rowCount === 0) {
    return [];
  }

  const jobIds = jobsResult.rows.map((row: JobRow) => row.id);
  const [analysisResult, outreachResult] = await Promise.all([
    pool.query<JobAnalysisRow>('select * from job_analysis where job_id = any($1::uuid[]) order by created_at desc', [
      jobIds,
    ]),
    pool.query<OutreachRow>('select * from outreach where job_id = any($1::uuid[]) order by created_at asc', [jobIds]),
  ]);

  const analysisByJobId = new Map<string, JobAnalysisRow>();
  for (const row of analysisResult.rows as JobAnalysisRow[]) {
    if (!analysisByJobId.has(row.job_id)) {
      analysisByJobId.set(row.job_id, row);
    }
  }

  const outreachByJobId = new Map<string, OutreachRow[]>();
  for (const row of outreachResult.rows as OutreachRow[]) {
    const drafts = outreachByJobId.get(row.job_id) ?? [];
    drafts.push(row);
    outreachByJobId.set(row.job_id, drafts);
  }

  return jobsResult.rows.map((row: JobRow) => mapJob(row, analysisByJobId.get(row.id), outreachByJobId.get(row.id)));
}

export async function countJobs(userId: string): Promise<number> {
  const pool = poolOrThrow();
  const { rows } = await pool.query<{ count: number }>(
    'select count(*)::int as count from jobs where user_id = $1',
    [userId],
  );
  return rows[0]?.count ?? 0;
}

/** The user's job for this posting, reached through any of its URLs (#346). Uses the canonical-URL index. */
export async function findJobByCanonicalUrl(userId: string, jobUrl: string): Promise<TrackedJobRef | undefined> {
  const { rows } = await poolOrThrow().query<TrackedJobRef>(
    'select id, company, title from jobs where user_id = $1 and canonical_url = $2 order by created_at limit 1',
    [userId, canonicalJobUrl(jobUrl)],
  );
  return rows[0];
}

/**
 * Fill `canonical_url` for rows stored before migration 026, with the same rule new rows
 * use. Runs at boot after migrations; only touches rows still missing it, so it is cheap
 * once done. Returns how many rows it filled.
 */
export async function backfillCanonicalUrls(batchSize = 500): Promise<number> {
  const pool = poolOrThrow();
  let filled = 0;
  for (;;) {
    const { rows } = await pool.query<{ id: string; job_url: string }>(
      'select id, job_url from jobs where canonical_url is null and job_url is not null limit $1',
      [batchSize],
    );
    if (rows.length === 0) return filled;
    await pool.query(
      `update jobs set canonical_url = batch.canonical_url
         from unnest($1::uuid[], $2::text[]) as batch(id, canonical_url)
        where jobs.id = batch.id`,
      [rows.map((row) => row.id), rows.map((row) => canonicalJobUrl(row.job_url))],
    );
    filled += rows.length;
  }
}

export async function getJobById(userId: string, jobId: string): Promise<JobRecord | undefined> {
  const pool = poolOrThrow();

  const { rows } = await pool.query<JobRow>(
    'select * from jobs where id::text = $1 and user_id = $2 limit 1',
    [jobId, userId],
  );
  const job = rows[0] as JobRow | undefined;

  if (!job) {
    return undefined;
  }

  const [analysisResult, outreachResult] = await Promise.all([
    pool.query<JobAnalysisRow>('select * from job_analysis where job_id::text = $1 order by created_at desc limit 1', [
      jobId,
    ]),
    pool.query<OutreachRow>('select * from outreach where job_id::text = $1 order by created_at asc', [jobId]),
  ]);

  return mapJob(job, analysisResult.rows[0] as JobAnalysisRow | undefined, outreachResult.rows as OutreachRow[]);
}

export async function createJob(userId: string, body: CreateJobBody): Promise<JobRecord> {
  const pool = poolOrThrow();
  const client = await pool.connect();
  const jobId = randomUUID();
  const timestamp = new Date().toISOString();
  const nextAction = UNSCORED_NEXT_ACTION;

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
  const sponsorLikelihood =
    body.sponsorLikelihood !== undefined && body.sponsorLikelihood !== null
      ? typeof body.sponsorLikelihood === 'object'
        ? JSON.stringify(body.sponsorLikelihood)
        : body.sponsorLikelihood
      : null;

  const canonicalUrl = body.jobUrl ? canonicalJobUrl(body.jobUrl) : null;

  try {
    await client.query('begin');

    // One row per posting even when two requests add it at once (#346): the check and the
    // insert run under a per-(user, posting) lock held until commit. It stands in for a
    // unique index, which can't be built while live accounts still hold duplicates.
    if (canonicalUrl) {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 346))', [`${userId}|${canonicalUrl}`]);
      const existing = await client.query<TrackedJobRef>(
        'select id, company, title from jobs where user_id = $1 and canonical_url = $2 order by created_at limit 1',
        [userId, canonicalUrl],
      );
      if (existing.rows[0]) throw new DuplicateJobError(existing.rows[0]);
    }

    const { rows } = await client.query<JobRow>(
      `
        insert into jobs (
          id,
          user_id,
          job_url,
          source,
          company,
          title,
          location,
          employment_type,
          workplace_type,
          date_posted,
          discovered_at,
          description_text,
          status,
          priority,
          fit_score,
          notes,
          next_action,
          salary_min,
          salary_max,
          salary_currency,
          seniority,
          sponsor_likelihood,
          content_hash,
          last_seen_at,
          liveness,
          created_at,
          updated_at,
          canonical_url
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
        )
        returning *
      `,
      [
        jobId,
        userId,
        body.jobUrl ?? null,
        body.source ?? 'manual',
        body.company.trim(),
        body.title.trim(),
        body.location?.trim() ?? 'Remote',
        body.employmentType?.trim() ?? 'Full-time',
        body.workplaceType ?? 'remote',
        body.datePosted ?? null,
        timestamp,
        body.descriptionText.trim(),
        body.status ?? 'discovered',
        body.priority ?? 'medium',
        null,
        body.notes?.trim() || null,
        body.nextAction ?? nextAction,
        salaryMin,
        salaryMax,
        salaryCurrency,
        seniority,
        sponsorLikelihood,
        contentHash,
        lastSeenAt,
        liveness,
        timestamp,
        timestamp,
        canonicalUrl,
      ],
    );

    const insertedJob = rows[0] as JobRow | undefined;
    if (!insertedJob) {
      throw new Error('Failed to create job');
    }

    await client.query('commit');
    const created = await getJobById(userId, insertedJob.id);
    if (!created) {
      throw new Error('Created job could not be reloaded');
    }

    return created;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateJob(
  userId: string,
  jobId: string,
  body: UpdateJobBody,
): Promise<JobRecord | undefined> {
  const pool = poolOrThrow();
  const client = await pool.connect();

  try {
    await client.query('begin');

    const { rows } = await client.query<JobRow>(
      `
        update jobs
        set
          status = coalesce($2, status),
          priority = coalesce($3, priority),
          notes = case when $4::text is null then notes else nullif($4::text, '') end,
          fit_score = coalesce($5, fit_score),
          next_action = case when $6::text is null then next_action else nullif($6::text, '') end,
          next_action_due = case when $7::timestamptz is null then next_action_due else $7::timestamptz end
        where id::text = $1 and user_id = $8
        returning *
      `,
      [
        jobId,
        body.status ?? null,
        body.priority ?? null,
        body.notes ?? null,
        typeof body.fitScore === 'undefined' ? null : body.fitScore,
        body.nextAction ?? null,
        body.nextActionDue ?? null,
        userId,
      ],
    );

    await client.query('commit');

    if (rows.length === 0) {
      return undefined;
    }

    return getJobById(userId, jobId);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function appendOutreachDraft(
  userId: string,
  jobId: string,
  draft: OutreachDraft,
): Promise<OutreachDraft | undefined> {
  const pool = poolOrThrow();
  const client = await pool.connect();

  try {
    await client.query('begin');

    const ownership = await client.query('select 1 from jobs where id::text = $1 and user_id = $2 limit 1', [
      jobId,
      userId,
    ]);
    if (ownership.rowCount === 0) {
      await client.query('rollback');
      return undefined;
    }

    // Replace only the superseded unsent draft; preserve approved/sent/skipped
    // rows, which carry real outreach history and dashboard/reporting state.
    await client.query("delete from outreach where job_id::text = $1 and status = 'drafted'", [jobId]);

    const { rows } = await client.query<OutreachRow>(
      `
        insert into outreach (
          id,
          job_id,
          contact_name,
          contact_role,
          contact_source,
          linkedin_url,
          email,
          message_type,
          draft_text,
          status,
          created_at,
          sent_at,
          follow_up_due
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
        )
        returning *
      `,
      [
        draft.id,
        jobId,
        draft.contactName ?? null,
        draft.contactRole ?? null,
        draft.contactSource ?? null,
        draft.linkedinUrl ?? null,
        draft.email ?? null,
        draft.messageType,
        draft.draftText,
        draft.status,
        draft.createdAt,
        draft.sentAt ?? null,
        draft.followUpDue ?? null,
      ],
    );

    const jobResult = await client.query<JobStateRow>('select status, next_action from jobs where id::text = $1 limit 1', [
      jobId,
    ]);
    const jobRow = jobResult.rows[0];
    const outreachResult = await client.query<OutreachRow>(
      'select * from outreach where job_id::text = $1 order by created_at asc',
      [jobId],
    );
    const jobUpdate = jobRow
      ? deriveOutreachJobUpdate(
          jobRow.status as JobRecord['status'],
          outreachResult.rows.map((row: OutreachRow) => mapOutreach(row)),
        )
      : null;

    if (jobRow) {
      await client.query(
        `
          update jobs
          set
            status = $2,
            next_action = $3,
            updated_at = now()
          where id::text = $1
        `,
        [
          jobId,
          jobUpdate?.status ?? (jobRow.status as JobRecord['status']),
          jobUpdate?.nextAction ?? jobRow.next_action,
        ],
      );
    }

    await client.query('commit');
    return rows[0] ? mapOutreach(rows[0]) : undefined;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateOutreachDraft(
  userId: string,
  outreachId: string,
  body: UpdateOutreachBody,
): Promise<OutreachDraft | undefined> {
  const pool = poolOrThrow();
  const client = await pool.connect();

  try {
    await client.query('begin');

    const { rows } = await client.query<OutreachRow>(
      `
        update outreach
        set
          status = coalesce($2, status),
          gmail_draft_id = case when $3::text is null then gmail_draft_id else nullif($3::text, '') end,
          sent_at = case
            when coalesce($2, status) = 'sent' then coalesce($4::timestamptz, sent_at, now())
            when $4::timestamptz is null then sent_at
            else $4::timestamptz
          end,
          follow_up_due = case when $5::timestamptz is null then follow_up_due else $5::timestamptz end
        where id::text = $1
          and job_id in (select id from jobs where user_id = $6)
        returning *
      `,
      [
        outreachId,
        body.status ?? null,
        body.gmailDraftId ?? null,
        body.sentAt ?? null,
        body.followUpDue ?? null,
        userId,
      ],
    );

    const outreach = rows[0] as OutreachRow | undefined;
    if (!outreach) {
      await client.query('rollback');
      return undefined;
    }

    const jobResult = await client.query<JobStateRow>('select status, next_action from jobs where id::text = $1 limit 1', [
      outreach.job_id,
    ]);
    const jobRow = jobResult.rows[0];
    const outreachRows = await client.query<OutreachRow>(
      'select * from outreach where job_id::text = $1 order by created_at asc',
      [outreach.job_id],
    );
    const jobUpdate = jobRow
      ? deriveOutreachJobUpdate(
          jobRow.status as JobRecord['status'],
          outreachRows.rows.map((row: OutreachRow) => mapOutreach(row)),
        )
      : null;

    if (jobRow) {
      await client.query(
        `
          update jobs
          set
            status = $2,
            next_action = $3,
            updated_at = now()
          where id::text = $1
        `,
        [
          outreach.job_id,
          jobUpdate?.status ?? (jobRow.status as JobRecord['status']),
          jobUpdate?.nextAction ?? jobRow.next_action,
        ],
      );
    }

    await client.query('commit');
    return mapOutreach(outreach);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function getOutreachDraft(
  userId: string,
  outreachId: string,
): Promise<{ draft: OutreachDraft; job: JobRecord } | undefined> {
  const pool = poolOrThrow();
  const { rows } = await pool.query<OutreachRow>(
    `
      select o.*
      from outreach o
      join jobs j on j.id = o.job_id
      where o.id::text = $1 and j.user_id = $2
      limit 1
    `,
    [outreachId, userId],
  );
  const row = rows[0];
  if (!row) return undefined;
  const draft = mapOutreach(row);
  const job = await getJobById(userId, row.job_id);
  if (!job) return undefined;
  return { draft, job };
}

export async function saveJobAnalysis(
  userId: string,
  jobId: string,
  analysis: JobAnalysis,
  fitScore?: number | null,
): Promise<JobRecord | undefined> {
  const pool = poolOrThrow();

  if (!validateJobAnalysis(analysis)) {
    throw new Error('Invalid job analysis payload');
  }

  const job = await getJobById(userId, jobId);
  if (!job) {
    return undefined;
  }

  const timestamp = new Date().toISOString();

  await pool.query(
    `
      insert into job_analysis (
        id,
        job_id,
        required_skills,
        preferred_skills,
        matched_skills,
        missing_skills,
        ats_keywords,
        fit_summary,
        recommended_resume_angle,
        apply_recommendation,
        confidence_score,
        model_used,
        sub_signals,
        created_at
      ) values (
        $1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13::jsonb, $14
      )
      on conflict (job_id) do update set
        required_skills = excluded.required_skills,
        preferred_skills = excluded.preferred_skills,
        matched_skills = excluded.matched_skills,
        missing_skills = excluded.missing_skills,
        ats_keywords = excluded.ats_keywords,
        fit_summary = excluded.fit_summary,
        recommended_resume_angle = excluded.recommended_resume_angle,
        apply_recommendation = excluded.apply_recommendation,
        confidence_score = excluded.confidence_score,
        model_used = excluded.model_used,
        sub_signals = excluded.sub_signals,
        created_at = excluded.created_at
    `,
    [
      randomUUID(),
      jobId,
      JSON.stringify(analysis.requiredSkills),
      JSON.stringify(analysis.preferredSkills),
      JSON.stringify(analysis.matchedSkills),
      JSON.stringify(analysis.missingSkills),
      JSON.stringify(analysis.atsKeywords),
      analysis.fitSummary,
      analysis.recommendedResumeAngle,
      analysis.applyRecommendation,
      analysis.confidenceScore,
      analysis.modelUsed,
      JSON.stringify(analysis.subSignals ?? {}),
      timestamp,
    ],
  );

  // A scored job must stop telling you to score it.
  const nextAction = deriveAnalyzedNextAction(job.nextAction, analysis.modelUsed, fitScore);

  // The derivation ran against the `job` read above, and the analysis insert
  // has been awaited since — long enough for the user to have edited the next
  // action from another request. So the write re-checks the stored value
  // itself: replace only when the derivation said yes AND the column still
  // holds the untouched creation-time prompt. `coalesce` alone would not do
  // this; it only covers the case where the derivation declined.
  if (fitScore !== undefined) {
    await pool.query(
      `
        update jobs
        set
          fit_score = $2,
          next_action = case
            when $3::text is not null and btrim(next_action) = $4::text then $3::text
            else next_action
          end,
          updated_at = now()
        where id::text = $1
      `,
      [jobId, fitScore, nextAction, UNSCORED_NEXT_ACTION],
    );
  } else {
    await pool.query(
      `
        update jobs
        set
          next_action = case
            when $2::text is not null and btrim(next_action) = $3::text then $2::text
            else next_action
          end,
          updated_at = now()
        where id::text = $1
      `,
      [jobId, nextAction, UNSCORED_NEXT_ACTION],
    );
  }

  return getJobById(userId, jobId);
}

export async function updateOutreachGmailDraftId(
  userId: string,
  outreachId: string,
  gmailDraftId: string,
): Promise<OutreachDraft | undefined> {
  const pool = poolOrThrow();
  const client = await pool.connect();

  try {
    await client.query('begin');

    const { rows } = await client.query<OutreachRow>(
      `
        update outreach
        set gmail_draft_id = case when $2::text is null then gmail_draft_id else nullif($2::text, '') end
        where id::text = $1
          and job_id in (select id from jobs where user_id = $3)
        returning *
      `,
      [outreachId, gmailDraftId, userId],
    );

    const outreach = rows[0] as OutreachRow | undefined;
    if (!outreach) {
      await client.query('rollback');
      return undefined;
    }

    await client.query('commit');
    return mapOutreach(outreach);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/** Delete a user's jobs (cascades analysis/outreach) and their embeddings. */
export async function clearUserData(userId: string): Promise<void> {
  const pool = poolOrThrow();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from embeddings where user_id = $1', [userId]);
    await client.query('delete from jobs where user_id = $1', [userId]);
    await client.query('delete from resume_versions where user_id = $1', [userId]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/** Replace a user's data with the sample CRM (for instant demos). */
export async function seedDemoData(userId: string): Promise<void> {
  await clearUserData(userId);
  const pool = poolOrThrow();
  const client = await pool.connect();
  try {
    await client.query('begin');

    for (const job of seedJobs) {
      const jobId = randomUUID();
      await client.query(
        `insert into jobs (
          id, user_id, job_url, source, company, title, location, employment_type,
          workplace_type, date_posted, discovered_at, description_text, status, priority,
          fit_score, notes, next_action, next_action_due,
          salary_min, salary_max, salary_currency, seniority, sponsor_likelihood,
          content_hash, last_seen_at, liveness,
          created_at, updated_at, canonical_url
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
        )`,
        [
          jobId,
          userId,
          job.jobUrl ?? null,
          job.source,
          job.company,
          job.title,
          job.location,
          job.employmentType,
          job.workplaceType,
          job.datePosted ?? null,
          job.discoveredAt,
          job.descriptionText,
          job.status,
          job.priority,
          job.fitScore,
          job.notes ?? null,
          job.nextAction ?? null,
          job.nextActionDue ?? null,
          job.salaryMin ?? null,
          job.salaryMax ?? null,
          job.salaryCurrency ?? null,
          job.seniority ?? null,
          job.sponsorLikelihood
            ? typeof job.sponsorLikelihood === 'object'
              ? JSON.stringify(job.sponsorLikelihood)
              : job.sponsorLikelihood
            : null,
          job.contentHash ?? null,
          job.lastSeenAt ?? job.discoveredAt,
          job.liveness ?? 'active',
          job.createdAt,
          job.updatedAt,
          job.jobUrl ? canonicalJobUrl(job.jobUrl) : null,
        ],
      );

      if (job.analysis) {
        await client.query(
          `insert into job_analysis (
            id, job_id, required_skills, preferred_skills, matched_skills, missing_skills,
            ats_keywords, fit_summary, recommended_resume_angle, apply_recommendation,
            confidence_score, model_used, created_at
          ) values ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13)`,
          [
            randomUUID(),
            jobId,
            JSON.stringify(job.analysis.requiredSkills),
            JSON.stringify(job.analysis.preferredSkills),
            JSON.stringify(job.analysis.matchedSkills),
            JSON.stringify(job.analysis.missingSkills),
            JSON.stringify(job.analysis.atsKeywords),
            job.analysis.fitSummary,
            job.analysis.recommendedResumeAngle,
            job.analysis.applyRecommendation,
            job.analysis.confidenceScore,
            job.analysis.modelUsed,
            job.createdAt,
          ],
        );
      }

      for (const draft of job.outreach) {
        await client.query(
          `insert into outreach (
            id, job_id, contact_name, contact_role, contact_source, linkedin_url, email,
            message_type, draft_text, gmail_draft_id, status, created_at, sent_at, follow_up_due
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            randomUUID(),
            jobId,
            draft.contactName ?? null,
            draft.contactRole ?? null,
            draft.contactSource ?? null,
            draft.linkedinUrl ?? null,
            draft.email ?? null,
            draft.messageType,
            draft.draftText,
            draft.gmailDraftId ?? null,
            draft.status,
            draft.createdAt,
            draft.sentAt ?? null,
            draft.followUpDue ?? null,
          ],
        );
      }
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function touchJobsSeen(userId: string, jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) {
    return;
  }
  const pool = getPool();
  if (!pool) {
    return;
  }
  await pool.query(
    `update jobs set last_seen_at = now(), liveness = 'active' where user_id = $1 and id = any($2::uuid[])`,
    [userId, jobIds],
  );
}

export async function getJobStatusEvents(userId: string): Promise<JobStatusEvent[]> {
  const pool = getPool();
  if (!pool) return [];
  try {
    const { rows } = await pool.query<{
      id: string;
      job_id: string;
      user_id: string;
      from_status: string | null;
      to_status: string;
      created_at: string;
    }>(
      `select id, job_id, user_id, from_status, to_status, created_at from job_status_events where user_id = $1 order by created_at asc`,
      [userId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      jobId: r.job_id,
      userId: r.user_id,
      fromStatus: (r.from_status as JobStatus) || null,
      toStatus: r.to_status as JobStatus,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  } catch {
    return [];
  }
}

export async function getRankedFeed(
  userId: string,
  options: FeedQueryOptions = {},
): Promise<FeedResult> {
  const [jobs, events] = await Promise.all([listJobs(userId), getJobStatusEvents(userId)]);
  const stats = buildOutcomeStats(jobs, events);
  return rankFeedJobs(jobs, stats, options);
}
