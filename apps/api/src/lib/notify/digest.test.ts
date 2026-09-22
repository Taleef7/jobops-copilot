import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  _resetNotificationStoreForTests,
  insertNotification,
  listUsersForDigest,
  updateNotificationSettings,
} from '@/data/notification-store';
import { createJob, resetJobStoreForTests, updateJob } from '@/data/job-store';
import { generateDailyDigest } from './digest';

const TEST_USER = 'user_digest_test';

test('generateDailyDigest aggregates matches, follow-ups, and approvals with idempotency', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-digest-test-'));

  try {
    process.chdir(tempDir);
    resetJobStoreForTests();
    await _resetNotificationStoreForTests([], {});

    // 1. Setup user settings
    await updateNotificationSettings(TEST_USER, {
      channels: { in_app: true, email: false, telegram: false, web_push: false },
      minMatchScore: 80,
      digestHour: 9,
    });

    // 2. Seed a high match job
    const job1 = await createJob(TEST_USER, {
      title: 'Senior Platform Engineer',
      company: 'Datadog',
      descriptionText: 'Senior Platform Engineer with Kubernetes, Go, TypeScript and Distributed Systems.',
      status: 'shortlisted',
    });

    // Update job analysis confidence score to 90%
    job1.analysis = {
      requiredSkills: ['Kubernetes', 'Go'],
      preferredSkills: ['TypeScript'],
      matchedSkills: ['Kubernetes', 'Go', 'TypeScript'],
      missingSkills: [],
      atsKeywords: ['Kubernetes', 'Go', 'TypeScript'],
      fitSummary: 'Excellent match for distributed platform role',
      recommendedResumeAngle: 'Focus on distributed systems',
      applyRecommendation: 'apply',
      confidenceScore: 0.90,
      modelUsed: 'test-model',
    };

    // 3. Seed an overdue follow-up job relative to asOf
    const asOf = new Date('2026-09-22T10:00:00Z');
    const yesterday = new Date(asOf.getTime() - 86_400_000).toISOString();
    const job2 = await createJob(TEST_USER, {
      title: 'Backend Engineer',
      company: 'Linear',
      descriptionText: 'Fast-paced product engineering',
      status: 'applied',
    });
    await updateJob(TEST_USER, job2.id, {
      nextAction: 'Check in with hiring manager',
      nextActionDue: yesterday,
    });

    // 4. Seed an approval_needed notification
    await insertNotification(TEST_USER, {
      kind: 'approval_needed',
      title: 'Outreach Draft Ready for Review',
      body: 'Recruiter message for Linear is awaiting your approval',
      channels: { in_app: { status: 'sent', sentAt: new Date().toISOString() } },
    });

    // 5. Generate daily digest
    const digestRecord = await generateDailyDigest(TEST_USER, asOf);

    assert.equal(digestRecord.kind, 'digest');
    assert.match(digestRecord.title, /Daily Digest/i);
    assert.match(digestRecord.dedupeKey || '', /daily_digest:user_digest_test:2026-09-22/);
    assert.equal(digestRecord.channels.in_app?.status, 'sent');
    assert.ok(digestRecord.body.includes('Linear'));
    assert.ok(digestRecord.body.includes('Outreach Draft Ready'));

    // 6. Idempotency test: calling again on same date returns existing record
    const secondDigest = await generateDailyDigest(TEST_USER, asOf);
    assert.equal(secondDigest.id, digestRecord.id);

    // 7. listUsersForDigest checks digestHour matching
    const hour9Users = await listUsersForDigest(9);
    assert.equal(hour9Users.some((u) => u.userId === TEST_USER), true);

    const hour14Users = await listUsersForDigest(14);
    assert.equal(hour14Users.some((u) => u.userId === TEST_USER), false);
  } finally {
    process.chdir(originalCwd);
  }
});
