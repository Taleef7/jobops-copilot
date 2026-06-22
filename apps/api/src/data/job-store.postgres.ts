import { randomUUID } from 'node:crypto';
import type {
  CreateJobBody,
  JobAnalysis,
  JobRecord,
  OutreachDraft,
  UpdateJobBody,
  UpdateOutreachBody,
} from '@/types';
import { getDefaultAnalysis, validateJobAnalysis } from '@/lib/analysis-core';
import { getPool } from '@/lib/postgres';
import { deriveOutreachJobUpdate } from '@/lib/outreach-workflow';
import { seedJobs } from '@/data/mock-store';

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

function mapAnalysis(row: JobAnalysisRow | undefined, descriptionText: string): JobAnalysis {
  if (!row) {
    return getDefaultAnalysis(descriptionText);
  }

  const analysis = {
    requiredSkills: toTextArray(row.required_skills),
    preferredSkills: toTextArray(row.preferred_skills),
    matchedSkills: toTextArray(row.matched_skills),
    missingSkills: toTextArray(row.missing_skills),
    atsKeywords: toTextArray(row.ats_keywords),
    fitSummary: row.fit_summary,
    recommendedResumeAngle: row.recommended_resume_angle,
    applyRecommendation: row.apply_recommendation,
    confidenceScore: row.confidence_score ?? 0,
    modelUsed: row.model_used,
  } satisfies JobAnalysis;

  return validateJobAnalysis(analysis) ? analysis : getDefaultAnalysis(descriptionText);
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
    analysis: mapAnalysis(analysisRow, row.description_text),
    outreach: outreachRows.map(mapOutreach),
    createdAt: toIsoString(row.created_at) ?? row.created_at,
    updatedAt: toIsoString(row.updated_at) ?? row.updated_at,
  };
}

export async function listJobs(userId: string): Promise<JobRecord[]> {
  const pool = poolOrThrow();

  const jobsResult = await pool.query<JobRow>(
    'select * from jobs where user_id = $1 order by created_at desc',
    [userId],
  );
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
  const nextAction = 'Run AI parsing and fit scoring after the record is saved.';

  try {
    await client.query('begin');

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
          created_at,
          updated_at
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
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
        'discovered',
        body.priority ?? 'medium',
        null,
        body.notes?.trim() || null,
        nextAction,
        timestamp,
        timestamp,
      ],
    );

    const insertedJob = rows[0] as JobRow | undefined;
    if (!insertedJob) {
      throw new Error('Failed to create job');
    }

    const defaultAnalysis = getDefaultAnalysis(body.descriptionText);
    await client.query(
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
          created_at
        ) values (
          $1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13
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
        created_at = excluded.created_at
      `,
      [
        randomUUID(),
        insertedJob.id,
        JSON.stringify(defaultAnalysis.requiredSkills),
        JSON.stringify(defaultAnalysis.preferredSkills),
        JSON.stringify(defaultAnalysis.matchedSkills),
        JSON.stringify(defaultAnalysis.missingSkills),
        JSON.stringify(defaultAnalysis.atsKeywords),
        defaultAnalysis.fitSummary,
        defaultAnalysis.recommendedResumeAngle,
        defaultAnalysis.applyRecommendation,
        defaultAnalysis.confidenceScore,
        defaultAnalysis.modelUsed,
        timestamp,
      ],
    );

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

    // Keep only the latest draft per job (replace, don't accumulate).
    await client.query('delete from outreach where job_id::text = $1', [jobId]);

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
        created_at
      ) values (
        $1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13
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
      timestamp,
    ],
  );

  if (fitScore !== undefined) {
    await pool.query('update jobs set fit_score = $2, updated_at = now() where id::text = $1', [jobId, fitScore]);
  } else {
    await pool.query('update jobs set updated_at = now() where id::text = $1', [jobId]);
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
          fit_score, notes, next_action, next_action_due, created_at, updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
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
          job.createdAt,
          job.updatedAt,
        ],
      );

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
