import { Router } from 'express';
import {
  createJob,
  getJobById,
  listJobs,
  updateJob,
} from '@/data/job-store';
import type { CreateJobBody, JobPriority, JobStatus, UpdateJobBody } from '@/types';

export const jobsRouter = Router();

const allowedPriorities = new Set<JobPriority>(['high', 'medium', 'low']);
const allowedStatuses = new Set<JobStatus>([
  'discovered',
  'shortlisted',
  'applied',
  'outreach_drafted',
  'outreach_sent',
  'referral_requested',
  'follow_up_due',
  'interview',
  'rejected',
  'offer',
  'archived',
]);

function isValidUrl(value: string) {
  try {
    // Reject whitespace and malformed URLs while still allowing local/test URLs.
    void new URL(value);
    return true;
  } catch {
    return false;
  }
}

jobsRouter.get('/', async (_request, response, next) => {
  try {
    response.json({
      jobs: await listJobs(),
    });
  } catch (error) {
    next(error);
  }
});

jobsRouter.post('/', async (request, response, next) => {
  try {
    const body = request.body as Partial<CreateJobBody>;
    const errors: Record<string, string> = {};
    const existingJobs = await listJobs();
    const normalizedJobUrl = body.jobUrl?.trim();

    if (!body.company?.trim()) {
      errors.company = 'Company is required.';
    }
    if (!body.title?.trim()) {
      errors.title = 'Job title is required.';
    }
    if (!body.descriptionText?.trim()) {
      errors.descriptionText = 'Job description is required.';
    }
    if (normalizedJobUrl && !isValidUrl(normalizedJobUrl)) {
      errors.jobUrl = 'Job URL must be a valid URL.';
    }
    if (normalizedJobUrl && existingJobs.some((job) => job.jobUrl === normalizedJobUrl)) {
      errors.jobUrl = 'A job with this URL already exists.';
    }
    if (body.priority && !allowedPriorities.has(body.priority)) {
      errors.priority = 'Priority must be high, medium, or low.';
    }
    if (body.workplaceType && !['remote', 'hybrid', 'onsite', 'flexible'].includes(body.workplaceType)) {
      errors.workplaceType = 'Workplace type must be remote, hybrid, onsite, or flexible.';
    }

    if (Object.keys(errors).length > 0) {
      response.status(400).json({ error: 'Invalid job payload', fields: errors });
      return;
    }

    const job = await createJob({
      company: body.company!.trim(),
      title: body.title!.trim(),
      descriptionText: body.descriptionText!.trim(),
      jobUrl: body.jobUrl?.trim() || undefined,
      source: body.source?.trim() || undefined,
      location: body.location?.trim() || undefined,
      employmentType: body.employmentType?.trim() || undefined,
      workplaceType: body.workplaceType,
      datePosted: body.datePosted || undefined,
      priority: body.priority,
      notes: body.notes?.trim() || undefined,
    });

    response.status(201).json({ job });
  } catch (error) {
    next(error);
  }
});

jobsRouter.get('/:id', async (request, response, next) => {
  try {
    const job = await getJobById(request.params.id);

    if (!job) {
      response.status(404).json({ error: 'Job not found' });
      return;
    }

    response.json({ job });
  } catch (error) {
    next(error);
  }
});

jobsRouter.patch('/:id', async (request, response, next) => {
  const body = request.body as UpdateJobBody;
  const errors: Record<string, string> = {};

  if (body.status && !allowedStatuses.has(body.status)) {
    errors.status = 'Invalid status value.';
  }
  if (body.priority && !allowedPriorities.has(body.priority)) {
    errors.priority = 'Priority must be high, medium, or low.';
  }
  if (
    typeof body.fitScore === 'number' &&
    (Number.isNaN(body.fitScore) || body.fitScore < 0 || body.fitScore > 100)
  ) {
    errors.fitScore = 'Fit score must be between 0 and 100.';
  }
  if (body.nextActionDue && Number.isNaN(Date.parse(body.nextActionDue))) {
    errors.nextActionDue = 'Next action due must be a valid date.';
  }

  if (Object.keys(errors).length > 0) {
    response.status(400).json({ error: 'Invalid job update payload', fields: errors });
    return;
  }

  try {
    const job = await updateJob(request.params.id, {
      status: body.status,
      priority: body.priority,
      notes: body.notes?.trim(),
      fitScore: typeof body.fitScore === 'undefined' ? undefined : body.fitScore,
      nextAction: body.nextAction?.trim(),
      nextActionDue: body.nextActionDue?.trim(),
    });

    if (!job) {
      response.status(404).json({ error: 'Job not found' });
      return;
    }

    response.json({ job });
  } catch (error) {
    next(error);
  }
});
