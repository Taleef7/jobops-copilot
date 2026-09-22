import { dispatchNotification } from '@/lib/notify/dispatcher';
import { getNotificationSettings, listNotifications } from '@/data/notification-store';
import { listJobs, getRankedFeed } from '@/data/job-store';
import { selectDueFollowUps } from '@/lib/n8n';
import type { NotificationRecord } from '@/types';

export interface DigestItemMatch {
  id: string;
  title: string;
  company: string;
  score: number;
  location?: string;
  url?: string;
}

export interface DigestItemFollowUp {
  jobId: string;
  title: string;
  company: string;
  nextAction: string;
  daysOverdue: number;
}

export interface DigestItemApproval {
  id: string;
  title: string;
  jobId?: string | null;
  body: string;
}

export interface DailyDigestData {
  date: string;
  matches: DigestItemMatch[];
  followUps: DigestItemFollowUp[];
  approvals: DigestItemApproval[];
}

export async function generateDailyDigest(
  userId: string,
  now: Date = new Date(),
): Promise<NotificationRecord> {
  const settings = await getNotificationSettings(userId);
  const minScore = settings.minMatchScore ?? 80;

  // 1. Gather Top Matches
  const feedResult = await getRankedFeed(userId, { minScore, limit: 10 });
  const topMatches: DigestItemMatch[] = (feedResult.items || [])
    .filter((item) => (item.fitScore ?? 0) >= minScore)
    .slice(0, 5)
    .map((item) => ({
      id: item.job.id,
      title: item.job.title,
      company: item.job.company,
      score: Math.round(item.fitScore ?? 0),
      location: item.job.location,
      url: item.job.jobUrl,
    }));

  // 2. Gather Due Follow-ups
  const allJobs = await listJobs(userId);
  const dueFollowUps = selectDueFollowUps(allJobs, now);
  const followUps: DigestItemFollowUp[] = dueFollowUps.slice(0, 5).map((fu) => ({
    jobId: fu.jobId,
    title: fu.title,
    company: fu.company,
    nextAction: fu.nextAction,
    daysOverdue: fu.daysOverdue,
  }));

  // 3. Gather Pending Approvals
  const unreadNotifs = await listNotifications(userId, { unreadOnly: true });
  const approvals: DigestItemApproval[] = unreadNotifs
    .filter((n) => n.kind === 'approval_needed')
    .slice(0, 5)
    .map((n) => ({
      id: n.id,
      title: n.title,
      jobId: n.jobId,
      body: n.body,
    }));

  const dateIso = now.toISOString().slice(0, 10);
  const dedupeKey = `daily_digest:${userId}:${dateIso}`;

  // 4. Construct title and body
  const parts: string[] = [];
  parts.push(`JobOps Daily Digest for ${dateIso}`);
  parts.push('');

  if (topMatches.length > 0) {
    parts.push(`🎯 Top High-Fit Matches (${topMatches.length}):`);
    for (const m of topMatches) {
      parts.push(`• ${m.title} at ${m.company} (${m.score}% match)`);
    }
    parts.push('');
  } else {
    parts.push('🎯 Top High-Fit Matches: None today above your threshold.');
    parts.push('');
  }

  if (followUps.length > 0) {
    parts.push(`⏰ Follow-ups Due (${followUps.length}):`);
    for (const f of followUps) {
      const overdueNotice = f.daysOverdue > 0 ? ` (${f.daysOverdue}d overdue)` : '';
      parts.push(`• ${f.company} - ${f.nextAction}${overdueNotice}`);
    }
    parts.push('');
  } else {
    parts.push('⏰ Follow-ups Due: None due today.');
    parts.push('');
  }

  if (approvals.length > 0) {
    parts.push(`✍️ Approvals Pending (${approvals.length}):`);
    for (const a of approvals) {
      parts.push(`• ${a.title}`);
    }
    parts.push('');
  } else {
    parts.push('✍️ Approvals Pending: All caught up.');
  }

  const titleSummary = `${topMatches.length} matches, ${followUps.length} follow-ups, ${approvals.length} approvals`;
  const title = `Daily Digest: ${titleSummary}`;

  const digestData: DailyDigestData = {
    date: dateIso,
    matches: topMatches,
    followUps,
    approvals,
  };

  return dispatchNotification(userId, {
    kind: 'digest',
    title,
    body: parts.join('\n').trim(),
    dedupeKey,
    metadata: { digest: digestData },
  });
}
