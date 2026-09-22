import assert from 'node:assert/strict';
import test from 'node:test';
import type { JobRecord, JobStatusEvent } from '@/types';
import {
  buildOutcomeStats,
  extractTitleTokens,
  rankFeedJobs,
} from './feed-ranking';

function createMockJob(overrides: Partial<JobRecord> = {}): JobRecord {
  const now = new Date().toISOString();
  return {
    id: 'job-1',
    userId: 'user-1',
    company: 'Acme Corp',
    title: 'Senior Software Engineer',
    location: 'Remote',
    employmentType: 'Full-time',
    workplaceType: 'remote',
    datePosted: now,
    discoveredAt: now,
    descriptionText: 'Building scalable systems with TypeScript and Node.js.',
    status: 'discovered',
    priority: 'medium',
    fitScore: 80,
    outreach: [],
    analysis: {
      requiredSkills: ['TypeScript', 'Node.js'],
      preferredSkills: ['PostgreSQL'],
      matchedSkills: ['TypeScript', 'Node.js'],
      missingSkills: [],
      atsKeywords: ['TypeScript', 'Node.js'],
      fitSummary: 'Strong match',
      recommendedResumeAngle: 'Focus on backend experience',
      applyRecommendation: 'apply',
      confidenceScore: 85,
      modelUsed: 'mock',
      subSignals: {
        skillsMatch: 88,
        titleSeniority: 85,
        salaryFit: 80,
        sponsorshipLikelihood: 90,
      },
    },
    createdAt: now,
    updatedAt: now,
    source: 'manual',
    ...overrides,
  } as JobRecord;
}

test('extractTitleTokens tokenizes and normalizes role titles', () => {
  const tokens = extractTitleTokens('Senior Full-Stack AI Engineer / Tech Lead');
  assert.ok(tokens.has('senior'));
  assert.ok(tokens.has('stack'));
  assert.ok(tokens.has('engineer'));
  assert.ok(tokens.has('lead'));
  assert.ok(tokens.has('ai'));
});

test('buildOutcomeStats distinguishes outright rejections from interviewed-then-rejected', () => {
  const jobs: JobRecord[] = [
    // Job 1: Interviewed then rejected at Meta
    createMockJob({ id: 'j-1', company: 'Meta', title: 'Backend Engineer', status: 'rejected' }),
    // Job 2: Outright rejected at Google (no interview)
    createMockJob({ id: 'j-2', company: 'Google', title: 'Frontend Engineer', status: 'rejected' }),
    // Job 3: Outright rejected at Google (no interview)
    createMockJob({ id: 'j-3', company: 'Google', title: 'Fullstack Engineer', status: 'rejected' }),
  ];

  const events: JobStatusEvent[] = [
    // j-1 had an interview transition before being rejected
    {
      id: 'e-1',
      jobId: 'j-1',
      userId: 'user-1',
      fromStatus: 'applied',
      toStatus: 'interview',
      createdAt: '2026-06-01T00:00:00Z',
    },
    {
      id: 'e-2',
      jobId: 'j-1',
      userId: 'user-1',
      fromStatus: 'interview',
      toStatus: 'rejected',
      createdAt: '2026-06-10T00:00:00Z',
    },
    // j-2 and j-3 went straight to rejected
    {
      id: 'e-3',
      jobId: 'j-2',
      userId: 'user-1',
      fromStatus: 'applied',
      toStatus: 'rejected',
      createdAt: '2026-06-02T00:00:00Z',
    },
    {
      id: 'e-4',
      jobId: 'j-3',
      userId: 'user-1',
      fromStatus: 'applied',
      toStatus: 'rejected',
      createdAt: '2026-06-03T00:00:00Z',
    },
  ];

  const stats = buildOutcomeStats(jobs, events);

  // Meta had an interview!
  assert.equal(stats.companyInterviewCounts.get('meta'), 1);
  assert.equal(stats.companyOutrightRejectedCounts.get('meta') ?? 0, 0);

  // Google had 2 outright rejections with 0 interviews
  assert.equal(stats.companyInterviewCounts.get('google') ?? 0, 0);
  assert.equal(stats.companyOutrightRejectedCounts.get('google'), 2);

  // Meta role title tokens should be counted as successful title tokens
  assert.ok(stats.successfulTitleTokens.has('backend'));
  assert.ok(stats.successfulTitleTokens.has('engineer'));
});

test('rankFeedJobs boosts companies with positive interview track record and penalizes outright rejected companies', () => {
  const jobs: JobRecord[] = [
    createMockJob({ id: 'j-meta', company: 'Meta', title: 'Data Engineer', fitScore: 80 }),
    createMockJob({ id: 'j-google', company: 'Google', title: 'DevOps Engineer', fitScore: 80 }),
    createMockJob({ id: 'j-neutral', company: 'Neutral Inc', title: 'Systems Engineer', fitScore: 80 }),
  ];

  const stats = {
    companyInterviewCounts: new Map([['meta', 1]]),
    companyOutrightRejectedCounts: new Map([['google', 2]]),
    successfulTitleTokens: new Set<string>(),
  };

  const result = rankFeedJobs(jobs, stats, {}, Date.now());

  const metaItem = result.items.find((i) => i.job.id === 'j-meta');
  const googleItem = result.items.find((i) => i.job.id === 'j-google');
  const neutralItem = result.items.find((i) => i.job.id === 'j-neutral');

  assert.ok(metaItem);
  assert.ok(googleItem);
  assert.ok(neutralItem);

  // Meta got +10 interview boost + 5 fresh (<24h) = 95
  assert.equal(metaItem.adjustedScore, 95);
  assert.ok(metaItem.rankReasons.some((r) => r.includes('Proven interview track record at Meta (+10)')));

  // Google got -15 rejection penalty + 5 fresh (<24h) = 70
  assert.equal(googleItem.adjustedScore, 70);
  assert.ok(googleItem.rankReasons.some((r) => r.includes('Multiple previous rejections without interview at Google (-15)')));

  // Neutral got 0 company delta + 5 fresh = 85
  assert.equal(neutralItem.adjustedScore, 85);

  // Order should be Meta (95), Neutral (85), Google (70)
  assert.equal(result.items[0]?.job.id, 'j-meta');
  assert.equal(result.items[1]?.job.id, 'j-neutral');
  assert.equal(result.items[2]?.job.id, 'j-google');
});

test('rankFeedJobs boosts jobs matching title family of previous interview success', () => {
  const jobs: JobRecord[] = [
    createMockJob({ id: 'j-backend', company: 'Startup A', title: 'Senior Backend Engineer', fitScore: 75 }),
    createMockJob({ id: 'j-marketing', company: 'Startup B', title: 'Content Marketing Specialist', fitScore: 75 }),
  ];

  const stats = {
    companyInterviewCounts: new Map<string, number>(),
    companyOutrightRejectedCounts: new Map<string, number>(),
    successfulTitleTokens: new Set(['backend', 'engineer']),
  };

  const result = rankFeedJobs(jobs, stats, {}, Date.now());

  const backendItem = result.items.find((i) => i.job.id === 'j-backend');
  const marketingItem = result.items.find((i) => i.job.id === 'j-marketing');

  assert.ok(backendItem);
  assert.ok(marketingItem);

  // Backend matched successful title family (+8) + fresh (+5) = 88
  assert.equal(backendItem.adjustedScore, 88);
  assert.ok(backendItem.rankReasons.some((r) => r.includes('Target role aligns with previous interview success (+8)')));

  // Marketing had no title family match: 75 + fresh (+5) = 80
  assert.equal(marketingItem.adjustedScore, 80);
});

test('rankFeedJobs penalizes stale and expired postings and filters by min_score and sponsor', () => {
  const now = Date.now();
  const jobs: JobRecord[] = [
    createMockJob({ id: 'j-active', fitScore: 80, liveness: 'active', sponsorLikelihood: 'likely' }),
    createMockJob({ id: 'j-stale', fitScore: 80, liveness: 'stale', sponsorLikelihood: 'likely' }),
    createMockJob({ id: 'j-expired', fitScore: 80, liveness: 'expired', sponsorLikelihood: 'unlikely' }),
  ];

  const stats = {
    companyInterviewCounts: new Map<string, number>(),
    companyOutrightRejectedCounts: new Map<string, number>(),
    successfulTitleTokens: new Set<string>(),
  };

  const allRanked = rankFeedJobs(jobs, stats, {}, now);
  const activeItem = allRanked.items.find((i) => i.job.id === 'j-active');
  const staleItem = allRanked.items.find((i) => i.job.id === 'j-stale');
  const expiredItem = allRanked.items.find((i) => i.job.id === 'j-expired');

  assert.equal(activeItem?.adjustedScore, 85); // 80 + 5 fresh
  assert.equal(staleItem?.adjustedScore, 75);  // 80 + 5 fresh - 10 stale
  assert.equal(expiredItem?.adjustedScore, 55); // 80 + 5 fresh - 30 expired

  // Filter by minScore = 80
  const filteredScore = rankFeedJobs(jobs, stats, { minScore: 80 }, now);
  assert.equal(filteredScore.items.length, 1);
  assert.equal(filteredScore.items[0]?.job.id, 'j-active');

  // Filter by sponsorOnly
  const sponsorFiltered = rankFeedJobs(jobs, stats, { sponsorOnly: true }, now);
  assert.equal(sponsorFiltered.items.length, 2); // active and stale have likely
});

test('rankFeedJobs applies 50% defaults per property when subSignals is empty object or missing', () => {
  const now = Date.now();
  const job = createMockJob({
    id: 'j-empty-signals',
    fitScore: null,
    analysis: {
      ...createMockJob().analysis!,
      subSignals: {} as unknown as NonNullable<NonNullable<JobRecord['analysis']>['subSignals']>,
    },
  });

  const stats = {
    companyInterviewCounts: new Map<string, number>(),
    companyOutrightRejectedCounts: new Map<string, number>(),
    successfulTitleTokens: new Set<string>(),
  };

  const ranked = rankFeedJobs([job], stats, {}, now);
  assert.equal(ranked.items.length, 1);
  assert.deepEqual(ranked.items[0]?.subSignals, {
    skillsMatch: 50,
    titleSeniority: 50,
    salaryFit: 50,
    sponsorshipLikelihood: 50,
  });
});

