import { Router, type Response } from 'express';
import { DuplicateJobError } from '@/data/duplicate-job';
import {
  createJob,
  findJobByCanonicalUrl,
  listJobs,
  saveJobAnalysis,
  updateJob,
} from '@/data/job-store';
import { saveWeeklyReport } from '@/data/report-store';
import { N8N_USER_ID } from '@/lib/auth';
import { analysisFromFit } from '@/lib/analysis-core';
import { AiUnavailableError, resolveFitScore, resolveParsedJob } from '@/lib/agent-client';
import { BUDGET_SPENT, runWithAiBudget } from '@/lib/budget';
import { exportWeeklyReportMarkdown } from '@/lib/report-export';
import { getRequestBaseUrl } from '@/lib/request-url';
import {
  buildFollowUpSummary,
  requireN8nWebhookSecret,
  selectDueFollowUps,
} from '@/lib/n8n';
import { buildWeeklyReportRecord, formatWeeklyReportResponse } from '@/lib/weekly-report';
import {
  emitFollowUpNotification,
  emitJobMatchNotification,
} from '@/lib/notify/events';
import type {
  JobPriority,
  JobWorkplaceType,
  N8nFollowUpRemindersBody,
  N8nJobIntakeBody,
  N8nWeeklyReportBody,
} from '@/types';

const allowedPriorities = new Set<JobPriority>(['high', 'medium', 'low']);
const allowedWorkplaceTypes = new Set<JobWorkplaceType>(['remote', 'hybrid', 'onsite', 'flexible']);

interface N8nDependencies {
  createJob: typeof createJob;
  findJobByCanonicalUrl: typeof findJobByCanonicalUrl;
  listJobs: typeof listJobs;
  saveJobAnalysis: typeof saveJobAnalysis;
  updateJob: typeof updateJob;
}

const defaultDependencies: N8nDependencies = {
  createJob,
  findJobByCanonicalUrl,
  listJobs,
  saveJobAnalysis,
  updateJob,
};

function trimValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isValidUrl(value: string) {
  try {
    void new URL(value);
    return true;
  } catch {
    return false;
  }
}

function validateJobIntakeBody(body: Partial<N8nJobIntakeBody>) {
  const errors: Record<string, string> = {};
  const normalizedJobUrl = trimValue(body.job_url);
  const normalizedCompany = trimValue(body.company);
  const normalizedTitle = trimValue(body.title);
  const normalizedDescription = trimValue(body.description_text);
  const normalizedSource = trimValue(body.source) ?? 'n8n';
  const normalizedLocation = trimValue(body.location);
  const normalizedEmploymentType = trimValue(body.employment_type);
  const normalizedDatePosted = trimValue(body.date_posted);
  const normalizedNotes = trimValue(body.notes);
  const normalizedResumeText = trimValue(body.resume_text);
  const normalizedProfileText = trimValue(body.profile_text);

  if (!normalizedCompany) {
    errors.company = 'Company is required.';
  }
  if (!normalizedTitle) {
    errors.title = 'Job title is required.';
  }
  if (!normalizedDescription) {
    errors.description_text = 'Job description is required.';
  }
  if (normalizedJobUrl && !isValidUrl(normalizedJobUrl)) {
    errors.job_url = 'Job URL must be a valid URL.';
  }
  if (body.priority && !allowedPriorities.has(body.priority)) {
    errors.priority = 'Priority must be high, medium, or low.';
  }
  if (body.workplace_type && !allowedWorkplaceTypes.has(body.workplace_type)) {
    errors.workplace_type = 'Workplace type must be remote, hybrid, onsite, or flexible.';
  }
  if (normalizedDatePosted && Number.isNaN(Date.parse(normalizedDatePosted))) {
    errors.date_posted = 'date_posted must be a valid ISO date string.';
  }

  return {
    errors,
    normalized: {
      jobUrl: normalizedJobUrl,
      company: normalizedCompany,
      title: normalizedTitle,
      descriptionText: normalizedDescription,
      source: normalizedSource,
      location: normalizedLocation,
      employmentType: normalizedEmploymentType,
      workplaceType: body.workplace_type,
      datePosted: normalizedDatePosted,
      priority: body.priority,
      notes: normalizedNotes,
      resumeText: normalizedResumeText,
      profileText: normalizedProfileText,
    },
  };
}

function validateWeeklyReportBody(body: Partial<N8nWeeklyReportBody>) {
  const errors: Record<string, string> = {};
  const weekStart = trimValue(body.week_start);
  const weekEnd = trimValue(body.week_end);

  if (!weekStart) {
    errors.week_start = 'week_start is required.';
  } else if (Number.isNaN(Date.parse(weekStart))) {
    errors.week_start = 'week_start must be a valid date.';
  }

  if (!weekEnd) {
    errors.week_end = 'week_end is required.';
  } else if (Number.isNaN(Date.parse(weekEnd))) {
    errors.week_end = 'week_end must be a valid date.';
  }

  return {
    errors,
    normalized: {
      week_start: weekStart,
      week_end: weekEnd,
    },
  };
}

function validateFollowUpBody(body: Partial<N8nFollowUpRemindersBody>) {
  const errors: Record<string, string> = {};
  const asOf = trimValue(body.as_of);

  if (asOf && Number.isNaN(Date.parse(asOf))) {
    errors.as_of = 'as_of must be a valid date.';
  }

  return {
    errors,
    normalized: {
      as_of: asOf,
    },
  };
}

function alreadyTracked(response: Response, existingJobId: string) {
  response.status(409).json({
    error: 'A job with this URL already exists.',
    fields: {
      job_url: 'A job with this URL already exists.',
    },
    existing_job_id: existingJobId,
  });
}

export function createN8nRouter(dependencies: N8nDependencies = defaultDependencies) {
  const router = Router();

  router.use(requireN8nWebhookSecret);

  router.post('/job-intake', async (request, response, next) => {
    const userId = N8N_USER_ID;

    const body = request.body as Partial<N8nJobIntakeBody>;
    const validation = validateJobIntakeBody(body);

    try {
      if (Object.keys(validation.errors).length > 0) {
        response.status(400).json({
          error: 'Invalid n8n job intake payload',
          fields: validation.errors,
        });
        return;
      }

      // Any URL of a posting it already has (#346), by one indexed lookup.
      if (validation.normalized.jobUrl) {
        const existingJob = await dependencies.findJobByCanonicalUrl(userId, validation.normalized.jobUrl);
        if (existingJob) {
          alreadyTracked(response, existingJob.id);
          return;
        }
      }

      const createdJob = await dependencies.createJob(userId, {
        jobUrl: validation.normalized.jobUrl,
        source: validation.normalized.source,
        company: validation.normalized.company!,
        title: validation.normalized.title!,
        location: validation.normalized.location,
        employmentType: validation.normalized.employmentType,
        workplaceType: validation.normalized.workplaceType,
        datePosted: validation.normalized.datePosted,
        priority: validation.normalized.priority,
        notes: validation.normalized.notes,
        descriptionText: validation.normalized.descriptionText!,
      });

      // The parse/score calls below are paid LLM work owned by the n8n system user, so
      // they must respect that user's daily AI budget just like the /api/ai routes do,
      // including a large input's size (#345). When the budget is exhausted we still
      // create the job, but skip AI enrichment.
      // The job is created either way. The AI only enriches it, and when the AI can't
      // answer, the enrichment is skipped: nothing made up is saved (#349).
      const skippedIntake = (fitMessage: string, notification: string) =>
        response.status(201).json({
          workflow: 'job-intake',
          job: createdJob,
          parsed: null,
          fit_status: 'skipped',
          fit_message: fitMessage,
          notification,
        });

      let parsed: Awaited<ReturnType<typeof resolveParsedJob>> | typeof BUDGET_SPENT;
      try {
        parsed = await runWithAiBudget(userId, 'parse', () => resolveParsedJob(createdJob.descriptionText));
      } catch (error) {
        if (!(error instanceof AiUnavailableError)) throw error;
        skippedIntake(
          `AI enrichment skipped: ${error.message}`,
          'Job created. The AI could not parse it right now; score it from the job page.',
        );
        return;
      }
      if (parsed === BUDGET_SPENT) {
        skippedIntake(
          'AI enrichment skipped: the daily AI budget for this account is exhausted.',
          'Job created. AI parsing and scoring were skipped due to the daily AI budget.',
        );
        return;
      }

      let analysis: ReturnType<typeof analysisFromFit> | null = null;
      let fitStatus: 'skipped' | 'scored' = 'skipped';
      let fitMessage = 'Fit scoring was skipped because resume/profile context was not supplied.';
      let fitScore: number | null | undefined;

      if (validation.normalized.resumeText && validation.normalized.profileText) {
        const { resumeText, profileText } = validation.normalized;
        const parsedJob = parsed;
        let fit: Awaited<ReturnType<typeof resolveFitScore>> | typeof BUDGET_SPENT | null = null;
        try {
          fit = await runWithAiBudget(userId, 'score', () =>
            resolveFitScore({
              userId,
              descriptionText: createdJob.descriptionText,
              resumeText,
              profileText,
              title: parsedJob.title,
              requiredSkills: parsedJob.required_skills,
              preferredSkills: parsedJob.preferred_skills,
              atsKeywords: [...parsedJob.required_skills, ...parsedJob.preferred_skills],
            }),
          );
        } catch (error) {
          if (!(error instanceof AiUnavailableError)) throw error;
          fitMessage = `Fit scoring was skipped: ${error.message}`;
        }
        if (fit === BUDGET_SPENT) {
          fitMessage = 'Fit scoring was skipped because the daily AI budget for this account is exhausted.';
        } else if (fit) {
          analysis = analysisFromFit(fit, {
            requiredSkills: parsed.required_skills,
            preferredSkills: parsed.preferred_skills,
          });
          fitStatus = 'scored';
          fitMessage = `Fit scoring completed with a score of ${fit.fit_score}.`;
          fitScore = fit.fit_score;
        }
      } else if (validation.normalized.resumeText || validation.normalized.profileText) {
        fitMessage = 'Fit scoring was skipped because both resume_text and profile_text are required.';
      }

      // Only a real score is saved as the job's analysis.
      const savedJob = analysis
        ? await dependencies.saveJobAnalysis(userId, createdJob.id, analysis, fitScore)
        : createdJob;

      if (!savedJob) {
        response.status(500).json({ error: 'Could not save the n8n analysis result' });
        return;
      }

      const updatedJob = await dependencies.updateJob(userId, savedJob.id, {
        nextAction: fitStatus === 'scored'
          ? 'Review the AI analysis and decide whether to shortlist.'
          : 'Review the parsed job and decide whether to score it.',
      });

      if (fitStatus === 'scored' && fitScore != null) {
        await emitJobMatchNotification(userId, {
          id: savedJob.id,
          title: savedJob.title,
          company: savedJob.company,
          location: savedJob.location,
          fitScore,
          fitSummary: analysis?.fitSummary ?? '',
        });
      }

      response.status(201).json({
        workflow: 'job-intake',
        job: updatedJob ?? savedJob,
        parsed,
        fit_status: fitStatus,
        fit_message: fitMessage,
        notification:
          fitStatus === 'scored'
            ? 'Job created, parsed, scored, and queued for human review.'
            : 'Job created and parsed. Fit scoring can run once resume/profile context is available.',
      });
    } catch (error) {
      // Added at the same moment by another request (createJob re-checks under a lock).
      if (error instanceof DuplicateJobError) {
        alreadyTracked(response, error.existingJob.id);
        return;
      }
      next(error);
    }
  });

  router.post('/follow-up-reminders', async (request, response, next) => {
    const userId = N8N_USER_ID;

    const body = request.body as Partial<N8nFollowUpRemindersBody>;
    const validation = validateFollowUpBody(body);

    if (Object.keys(validation.errors).length > 0) {
      response.status(400).json({
        error: 'Invalid n8n follow-up payload',
        fields: validation.errors,
      });
      return;
    }

    try {
      const jobs = await dependencies.listJobs(userId);
      const asOf = validation.normalized.as_of ? new Date(validation.normalized.as_of) : new Date();
      const reminders = selectDueFollowUps(jobs, asOf);

      for (const reminder of reminders) {
        await emitFollowUpNotification(userId, reminder);
      }

      response.json({
        workflow: 'follow-up-reminders',
        generated_at: asOf.toISOString(),
        reminder_count: reminders.length,
        reminders,
        notification: buildFollowUpSummary(reminders),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/weekly-report', async (request, response, next) => {
    const userId = N8N_USER_ID;

    const body = request.body as Partial<N8nWeeklyReportBody>;
    const validation = validateWeeklyReportBody(body);

    if (Object.keys(validation.errors).length > 0) {
      response.status(400).json({
        error: 'Invalid n8n weekly report payload',
        fields: validation.errors,
      });
      return;
    }

    try {
      const jobs = await dependencies.listJobs(userId);
      const report = buildWeeklyReportRecord(jobs, {
        week_start: validation.normalized.week_start!,
        week_end: validation.normalized.week_end!,
      });
      const reportUrl = await exportWeeklyReportMarkdown(report, {
        publicBaseUrl: getRequestBaseUrl(request),
      });
      const savedReport = await saveWeeklyReport(userId, {
        ...report,
        reportUrl,
      });

      response.json({
        workflow: 'weekly-report',
        ...formatWeeklyReportResponse(savedReport),
        email_subject: `Weekly report summary for ${validation.normalized.week_start} to ${validation.normalized.week_end}`,
        email_body: savedReport.reportMarkdown,
        notification: 'Weekly report draft ready for n8n email delivery.',
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const n8nRouter = createN8nRouter();
