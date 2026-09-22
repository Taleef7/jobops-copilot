import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  _resetNotificationStoreForTests,
  listNotifications,
} from '@/data/notification-store';
import {
  emitApprovalNeededNotification,
  emitFollowUpNotification,
  emitJobMatchNotification,
} from './events';

const TEST_USER = 'user_events_test';

test('Event emitters create correctly typed, deduplicated notification records', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-events-test-'));

  try {
    process.chdir(tempDir);
    await _resetNotificationStoreForTests([], {});

    // 1. Emit job match notification
    const matchRecord = await emitJobMatchNotification(TEST_USER, {
      id: 'job-stripe-100',
      title: 'Senior Infrastructure Engineer',
      company: 'Stripe',
      location: 'San Francisco, CA',
      fitScore: 92,
      fitSummary: 'Strong match on distributed consensus and telemetry.',
    });

    assert.ok(matchRecord);
    assert.equal(matchRecord.kind, 'job_match');
    assert.equal(matchRecord.dedupeKey, 'job_match:job-stripe-100');
    assert.match(matchRecord.title, /Senior Infrastructure Engineer at Stripe/);
    assert.match(matchRecord.body, /Match score: 92%/);
    assert.equal(matchRecord.channels.in_app?.status, 'sent');

    // 2. Idempotency on repeated job match
    const secondMatch = await emitJobMatchNotification(TEST_USER, {
      id: 'job-stripe-100',
      title: 'Senior Infrastructure Engineer',
      company: 'Stripe',
      fitScore: 92,
    });
    assert.equal(secondMatch?.id, matchRecord.id);

    // 3. Emit follow-up notification
    const followUpRecord = await emitFollowUpNotification(TEST_USER, {
      jobId: 'job-stripe-100',
      company: 'Stripe',
      title: 'Senior Infrastructure Engineer',
      nextAction: 'Send thank you note to interviewer',
      nextActionDue: '2026-09-22T14:00:00Z',
      daysOverdue: 1,
    });

    assert.ok(followUpRecord);
    assert.equal(followUpRecord.kind, 'follow_up');
    assert.equal(followUpRecord.dedupeKey, 'follow_up:job-stripe-100:2026-09-22');
    assert.match(followUpRecord.title, /Follow-up Due: Stripe/);
    assert.match(followUpRecord.body, /1 days overdue/);

    // 4. Emit approval needed notification for resume tailor
    const approvalResume = await emitApprovalNeededNotification(TEST_USER, {
      kind: 'resume',
      targetId: 'version-rv-555',
      jobId: 'job-stripe-100',
      title: 'Review Tailored Resume for Stripe',
      body: 'Tailored resume draft is ready for review.',
    });

    assert.ok(approvalResume);
    assert.equal(approvalResume.kind, 'approval_needed');
    assert.equal(approvalResume.dedupeKey, 'approval_needed:resume:version-rv-555');

    // 5. Emit approval needed notification for outreach
    const approvalOutreach = await emitApprovalNeededNotification(TEST_USER, {
      kind: 'outreach',
      targetId: 'outreach-draft-777',
      jobId: 'job-stripe-100',
      title: 'Review Outreach Draft for Sarah Connor',
      body: 'Personalized draft message ready for recruiter.',
    });

    assert.ok(approvalOutreach);
    assert.equal(approvalOutreach.kind, 'approval_needed');
    assert.equal(approvalOutreach.dedupeKey, 'approval_needed:outreach:outreach-draft-777');

    // 6. Verify all 4 notifications recorded in in-app store
    const notifications = await listNotifications(TEST_USER);
    assert.equal(notifications.length, 4);
  } finally {
    process.chdir(originalCwd);
  }
});
