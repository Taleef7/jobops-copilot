import { Router } from 'express';
import {
  createJob,
  listJobs,
  saveJobAnalysis,
  updateJob,
} from '@/data/job-store';
import { saveWeeklyReport } from '@/data/report-store';
import { N8N_USER_ID } from '@/lib/auth';
import {
  analysisFromFit,
  analysisFromParsed,
  validateFitScoreOutput,
  validateParsedJobOutput,
} from '@/lib/analysis-core';
import { resolveFitScore, resolveParsedJob } from '@/lib/agent-client';
import { reserveAiBudget } from '@/lib/budget';
import { exportWeeklyReportMarkdown } from '@/lib/report-export';
import { getRequestBaseUrl } from '@/lib/request-url';
import {
  buildFollowUpSummary,
  requireN8nWebhookSecret,
  selectDueFollowUps,
} from '@/lib/n8n';
import { buildWeeklyReportRecord, formatWeeklyReportResponse } from '@/lib/weekly-report';
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
  listJobs: typeof listJobs;
  saveJobAnalysis: typeof saveJobAnalysis;
  updateJob: typeof updateJob;
}

const defaultDependencies: N8nDependencies = {
  createJob,
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

      const existingJobs = await dependencies.listJobs(userId);

      if (validation.normalized.jobUrl) {
        const existingJob = existingJobs.find((job) => job.jobUrl === validation.normalized.jobUrl);
        if (existingJob) {
          response.status(409).json({
            error: 'A job with this URL already exists.',
            fields: {
              job_url: 'A job with this URL already exists.',
            },
            existing_job_id: existingJob.id,
          });
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
      // they must respect that user's daily AI budget just like the /api/ai routes do.
      // When the budget is exhausted we still create the job, but skip AI enrichment.
      if (!(await reserveAiBudget(userId, 'parse'))) {
        response.status(201).json({
          workflow: 'job-intake',
          job: createdJob,
          parsed: null,
          fit_status: 'skipped',
          fit_message: 'AI enrichment skipped: the daily AI budget for this account is exhausted.',
          notification: 'Job created. AI parsing and scoring were skipped due to the daily AI budget.',
        });
        return;
      }

      const parsed = await resolveParsedJob(createdJob.descriptionText);

      if (!validateParsedJobOutput(parsed)) {
        response.status(500).json({ error: 'n8n parser returned an invalid payload' });
        return;
      }

      let analysis = analysisFromParsed(parsed);
      let fitStatus: 'skipped' | 'scored' = 'skipped';
      let fitMessage = 'Fit scoring was skipped because resume/profile context was not supplied.';
      let fitScore: number | null | undefined;

      if (validation.normalized.resumeText && validation.normalized.profileText) {
        if (!(await reserveAiBudget(userId, 'score'))) {
          fitMessage = 'Fit scoring was skipped because the daily AI budget for this account is exhausted.';
        } else {
          const fit = await resolveFitScore({
            userId,
            descriptionText: createdJob.descriptionText,
            resumeText: validation.normalized.resumeText,
            profileText: validation.normalized.profileText,
            title: parsed.title,
            requiredSkills: parsed.required_skills,
            preferredSkills: parsed.preferred_skills,
            atsKeywords: [...parsed.required_skills, ...parsed.preferred_skills],
          });

          if (!validateFitScoreOutput(fit)) {
            response.status(500).json({ error: 'n8n fit scorer returned an invalid payload' });
            return;
          }

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

      const savedJob = await dependencies.saveJobAnalysis(userId, createdJob.id, analysis, fitScore);

      if (!savedJob) {
        response.status(500).json({ error: 'Could not save the n8n analysis result' });
        return;
      }

      const updatedJob = await dependencies.updateJob(userId, savedJob.id, {
        nextAction: fitStatus === 'scored'
          ? 'Review the AI analysis and decide whether to shortlist.'
          : 'Review the parsed job and decide whether to score it.',
      });

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
