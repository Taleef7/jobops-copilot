import { Router } from 'express';
import { getRankedFeed } from '@/data/job-store';
import { requireUser } from '@/lib/auth';
import type { FeedQueryOptions, JobSeniority, JobStatus, JobWorkplaceType } from '@/types';

export const feedRouter = Router();

const allowedSeniorities = new Set<JobSeniority>(['junior', 'mid', 'senior', 'lead', 'unknown']);
const allowedWorkplaceTypes = new Set<JobWorkplaceType>(['remote', 'hybrid', 'onsite', 'flexible']);
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

feedRouter.get('/', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const query = request.query;

    const limit = query.limit ? Math.max(1, Math.min(100, Number(query.limit) || 20)) : 20;
    const offset = query.offset ? Math.max(0, Number(query.offset) || 0) : 0;
    const minScore =
      query.min_score !== undefined && !Number.isNaN(Number(query.min_score))
        ? Number(query.min_score)
        : undefined;

    const seniority =
      typeof query.seniority === 'string' && allowedSeniorities.has(query.seniority as JobSeniority)
        ? (query.seniority as JobSeniority)
        : undefined;

    const sponsorOnly =
      query.sponsor_only === 'true' || query.sponsor_only === '1';

    const status =
      typeof query.status === 'string' && allowedStatuses.has(query.status as JobStatus)
        ? (query.status as JobStatus)
        : undefined;

    const workplaceType =
      typeof query.workplace_type === 'string' &&
      allowedWorkplaceTypes.has(query.workplace_type as JobWorkplaceType)
        ? (query.workplace_type as JobWorkplaceType)
        : undefined;

    const options: FeedQueryOptions = {
      limit,
      offset,
      minScore,
      seniority,
      sponsorOnly,
      status,
      workplaceType,
    };

    const feedResult = await getRankedFeed(userId, options);

    response.set('X-Total-Count', String(feedResult.total));
    response.json(feedResult);
  } catch (error) {
    next(error);
  }
});
