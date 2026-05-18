import type { NextFunction, Request, Response } from 'express';
import type { JobRecord, JobStatus } from '@/types';

export const N8N_WEBHOOK_SECRET_HEADER = 'X-N8N-Webhook-Secret';

const actionableFollowUpStatuses = new Set<JobStatus>([
  'shortlisted',
  'applied',
  'outreach_drafted',
  'outreach_sent',
  'follow_up_due',
]);

export interface FollowUpReminder {
  jobId: string;
  company: string;
  title: string;
  status: JobStatus;
  nextAction: string;
  nextActionDue: string;
  outreachCount: number;
  daysOverdue: number;
}

export function requireN8nWebhookSecret(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const expectedSecret = process.env.N8N_WEBHOOK_SECRET?.trim();

  if (!expectedSecret) {
    response.status(503).json({ error: 'n8n webhook secret is not configured' });
    return;
  }

  const providedSecret = request.header(N8N_WEBHOOK_SECRET_HEADER)?.trim();

  if (providedSecret !== expectedSecret) {
    response.status(401).json({ error: 'Missing or invalid n8n webhook secret' });
    return;
  }

  next();
}

export function selectDueFollowUps(jobs: JobRecord[], asOf = new Date()): FollowUpReminder[] {
  return jobs
    .filter((job) => {
      if (!job.nextActionDue) {
        return false;
      }

      if (!actionableFollowUpStatuses.has(job.status)) {
        return false;
      }

      const dueAt = Date.parse(job.nextActionDue);
      return Number.isFinite(dueAt) && dueAt <= asOf.getTime();
    })
    .sort((left, right) => Date.parse(left.nextActionDue!) - Date.parse(right.nextActionDue!))
    .map((job) => {
      const dueAt = Date.parse(job.nextActionDue!);
      const daysOverdue = Math.max(0, Math.floor((asOf.getTime() - dueAt) / 86_400_000));

      return {
        jobId: job.id,
        company: job.company,
        title: job.title,
        status: job.status,
        nextAction: job.nextAction ?? 'Review the job and decide on the next step.',
        nextActionDue: job.nextActionDue!,
        outreachCount: job.outreach.length,
        daysOverdue,
      };
    });
}

export function buildFollowUpSummary(reminders: FollowUpReminder[]) {
  if (reminders.length === 0) {
    return 'No follow-up reminders are due right now.';
  }

  const overdueCount = reminders.filter((reminder) => reminder.daysOverdue > 0).length;
  const reminderWord = reminders.length === 1 ? 'reminder is' : 'reminders are';
  return overdueCount > 0
    ? `${reminders.length} follow-up ${reminderWord} due, including ${overdueCount} overdue.`
    : `${reminders.length} follow-up ${reminderWord} due right now.`;
}
