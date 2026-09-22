import { dispatchNotification } from '@/lib/notify/dispatcher';
import type { NotificationRecord } from '@/types';

export interface JobMatchEventInput {
  id: string;
  title: string;
  company: string;
  location?: string;
  fitScore: number;
  fitSummary?: string;
}

export interface FollowUpEventInput {
  jobId: string;
  company: string;
  title: string;
  nextAction: string;
  nextActionDue: string;
  daysOverdue: number;
}

export interface ApprovalNeededEventInput {
  kind: 'resume' | 'outreach';
  targetId: string;
  jobId?: string;
  title: string;
  body: string;
}

/**
 * Emits a job match notification when a job is intake/scored with high confidence.
 * Idempotent via `job_match:${job.id}` dedupe key.
 */
export async function emitJobMatchNotification(
  userId: string,
  job: JobMatchEventInput,
): Promise<NotificationRecord | null> {
  const locationStr = job.location ? ` (${job.location})` : '';
  const summaryStr = job.fitSummary ? ` ${job.fitSummary}` : '';

  try {
    return await dispatchNotification(userId, {
      kind: 'job_match',
      title: `${job.title} at ${job.company}`,
      body: `${job.company} is hiring for ${job.title}${locationStr}. Match score: ${job.fitScore}%.${summaryStr}`,
      jobId: job.id,
      matchScore: job.fitScore,
      dedupeKey: `job_match:${job.id}`,
    });
  } catch (error) {
    console.error('Failed to dispatch job_match notification:', error);
    return null;
  }
}

/**
 * Emits a follow-up nudge notification for a job whose next action is due or overdue.
 * Idempotent per job and due date.
 */
export async function emitFollowUpNotification(
  userId: string,
  reminder: FollowUpEventInput,
): Promise<NotificationRecord | null> {
  const datePart = reminder.nextActionDue.slice(0, 10);
  const overdueStr = reminder.daysOverdue > 0 ? ` (${reminder.daysOverdue} days overdue)` : '';

  try {
    return await dispatchNotification(userId, {
      kind: 'follow_up',
      title: `Follow-up Due: ${reminder.company}`,
      body: `Action required for ${reminder.title} at ${reminder.company}: "${reminder.nextAction}"${overdueStr}.`,
      jobId: reminder.jobId,
      dedupeKey: `follow_up:${reminder.jobId}:${datePart}`,
    });
  } catch (error) {
    console.error('Failed to dispatch follow_up notification:', error);
    return null;
  }
}

/**
 * Emits an approval_needed notification for an action requiring human approval
 * (e.g. tailored resume draft or personalized outreach draft).
 */
export async function emitApprovalNeededNotification(
  userId: string,
  input: ApprovalNeededEventInput,
): Promise<NotificationRecord | null> {
  try {
    return await dispatchNotification(userId, {
      kind: 'approval_needed',
      title: input.title,
      body: input.body,
      jobId: input.jobId,
      dedupeKey: `approval_needed:${input.kind}:${input.targetId}`,
    });
  } catch (error) {
    console.error('Failed to dispatch approval_needed notification:', error);
    return null;
  }
}
