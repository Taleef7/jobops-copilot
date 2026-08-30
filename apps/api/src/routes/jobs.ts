import { Router } from 'express';
import {
  countJobs,
  createJob,
  getJobById,
  listJobs,
  updateJob,
} from '@/data/job-store';
import { requireUser } from '@/lib/auth';
import { parsePageParams } from '@/lib/pagination';
import type {
  CreateJobBody,
  JobLiveness,
  JobPriority,
  JobSeniority,
  JobStatus,
  UpdateJobBody,
} from '@/types';

export const jobsRouter = Router();

const allowedPriorities = new Set<JobPriority>(['high', 'medium', 'low']);
const allowedSeniorities = new Set<JobSeniority>(['junior', 'mid', 'senior', 'lead', 'unknown']);
const allowedSponsorLikelihoodStrings = new Set<string>(['likely', 'possible', 'unlikely', 'unknown']);
const allowedLivenesses = new Set<JobLiveness>(['active', 'stale', 'expired']);
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

jobsRouter.get('/', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    // Opt-in pagination: no ?limit means the full list (the web filters client-side).
    const page = parsePageParams(request.query);
    const [jobs, total] = await Promise.all([listJobs(userId, page), countJobs(userId)]);
    response.set('X-Total-Count', String(total));
    response.json({ jobs });
  } catch (error) {
    next(error);
  }
});

jobsRouter.post('/', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const body = request.body as Partial<CreateJobBody>;
    const errors: Record<string, string> = {};
    const existingJobs = await listJobs(userId);
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
    if (body.seniority && !allowedSeniorities.has(body.seniority)) {
      errors.seniority = 'Seniority must be junior, mid, senior, lead, or unknown.';
    }
    if (body.sponsorLikelihood) {
      if (typeof body.sponsorLikelihood === 'string') {
        if (!allowedSponsorLikelihoodStrings.has(body.sponsorLikelihood)) {
          errors.sponsorLikelihood = 'Sponsor likelihood must be likely, possible, unlikely, or unknown.';
        }
      } else if (
        typeof body.sponsorLikelihood === 'object' &&
        body.sponsorLikelihood !== null
      ) {
        const s = body.sponsorLikelihood as { status?: unknown; approvals?: unknown; denials?: unknown };
        if (
          s.status !== 'known_sponsor' ||
          typeof s.approvals !== 'number' ||
          typeof s.denials !== 'number' ||
          Number.isNaN(s.approvals) ||
          Number.isNaN(s.denials)
        ) {
          errors.sponsorLikelihood =
            'Sponsor likelihood object must have status "known_sponsor" with numeric approvals and denials.';
        }
      } else {
        errors.sponsorLikelihood =
          'Sponsor likelihood must be a valid status string or known_sponsor object.';
      }
    }
    if (body.liveness && !allowedLivenesses.has(body.liveness)) {
      errors.liveness = 'Liveness must be active, stale, or expired.';
    }
    if (body.salaryMin !== undefined && body.salaryMin !== null && (typeof body.salaryMin !== 'number' || Number.isNaN(body.salaryMin))) {
      errors.salaryMin = 'Salary min must be a valid number.';
    }
    if (body.salaryMax !== undefined && body.salaryMax !== null && (typeof body.salaryMax !== 'number' || Number.isNaN(body.salaryMax))) {
      errors.salaryMax = 'Salary max must be a valid number.';
    }

    if (Object.keys(errors).length > 0) {
      response.status(400).json({ error: 'Invalid job payload', fields: errors });
      return;
    }

    const job = await createJob(userId, {
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
      salaryMin: body.salaryMin,
      salaryMax: body.salaryMax,
      salaryCurrency: body.salaryCurrency?.trim() || undefined,
      seniority: body.seniority,
      sponsorLikelihood: body.sponsorLikelihood,
      contentHash: body.contentHash?.trim() || undefined,
      lastSeenAt: body.lastSeenAt || undefined,
      liveness: body.liveness,
    });

    response.status(201).json({ job });
  } catch (error) {
    next(error);
  }
});

jobsRouter.get('/:id', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const job = await getJobById(userId, request.params.id);

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
  const userId = requireUser(request, response);
  if (!userId) return;

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
    const job = await updateJob(userId, request.params.id, {
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
