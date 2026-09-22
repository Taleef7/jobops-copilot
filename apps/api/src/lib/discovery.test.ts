import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreateJobBody, JobRecord, SavedSearch, TargetCompany } from '@/types';
import { runDiscoveryForUser, type DiscoveryDeps } from './discovery';
import type { SourcedJob } from '@/lib/job-sources/normalize';

const SEARCH: SavedSearch = {
  id: 's1',
  userId: 'u',
  query: 'ai',
  remoteOnly: false,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

function makeDeps(
  found: SourcedJob[],
  existing: Partial<JobRecord>[],
  resume = 'TypeScript and React engineer.',
): {
  deps: DiscoveryDeps;
  created: CreateJobBody[];
  analyses: Array<{ jobId: string; fitScore?: number | null; modelUsed: string; subSignals?: unknown }>;
} {
  const created: CreateJobBody[] = [];
  const analyses: Array<{ jobId: string; fitScore?: number | null; modelUsed: string; subSignals?: unknown }> = [];
  let n = 0;
  const deps: DiscoveryDeps = {
    source: { name: 'adzuna', search: async () => found },
    listJobs: async () => existing as unknown as JobRecord[],
    createJob: async (_userId, body) => {
      created.push(body);
      n += 1;
      return { ...(body as object), id: `job-${n}` } as unknown as JobRecord;
    },
    listSavedSearches: async () => [SEARCH],
    getResume: async () => resume,
    saveAnalysis: async (_userId, jobId, analysis, fitScore) => {
      analyses.push({ jobId, fitScore, modelUsed: analysis.modelUsed, subSignals: analysis.subSignals });
      return undefined;
    },
  };
  return { deps, created, analyses };
}

function sourced(url: string, overrides: Partial<SourcedJob> = {}): SourcedJob {
  return { source: 'adzuna', company: 'A', title: 'T', location: 'L', descriptionText: '', jobUrl: url, ...overrides };
}

test('inserts new jobs and skips duplicates of existing CRM jobs', async () => {
  const { deps, created } = makeDeps(
    [sourced('https://x/1'), sourced('https://x/2', { company: 'B', title: 'T2' })],
    [{ jobUrl: 'https://x/1', company: 'A', title: 'T', location: 'L' }],
  );

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(result.inserted, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.source, 'adzuna');
  assert.equal(created.length, 1);
  assert.equal(created[0]?.jobUrl, 'https://x/2');
});

test('dedupes repeated postings within the same run', async () => {
  const { deps, created } = makeDeps([sourced('https://dup/1'), sourced('https://dup/1')], []);

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(result.inserted, 1);
  assert.equal(result.skipped, 1);
  assert.equal(created.length, 1);
});

test('dedupes a URL-less source copy against a URL-backed CRM job', async () => {
  const urlless: SourcedJob = { source: 'adzuna', company: 'A', title: 'T', location: 'L', descriptionText: '' };
  const { deps, created } = makeDeps(
    [urlless],
    [{ jobUrl: 'https://x/1', company: 'A', title: 'T', location: 'L' }],
  );

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(result.inserted, 0);
  assert.equal(result.skipped, 1);
  assert.equal(created.length, 0);
});

test('dedupes a URL-less source copy against a URL-less CRM job (fingerprint match)', async () => {
  const urlless: SourcedJob = { source: 'adzuna', company: 'A', title: 'T', location: 'L', descriptionText: '' };
  const { deps, created } = makeDeps(
    [urlless],
    [{ company: 'A', title: 'T', location: 'L' }], // existing CRM job with no URL
  );

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(result.inserted, 0);
  assert.equal(result.skipped, 1);
  assert.equal(created.length, 0);
});

test('counts a concurrent duplicate insert (Postgres 23505) as skipped', async () => {
  const created: CreateJobBody[] = [];
  const deps: DiscoveryDeps = {
    source: {
      name: 'adzuna',
      search: async () => [sourced('https://race/1'), sourced('https://race/2', { company: 'B' })],
    },
    listJobs: async () => [],
    createJob: async (_userId, body) => {
      if (body.jobUrl === 'https://race/1') {
        throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
      }
      created.push(body);
      return { ...(body as object), id: 'job-x' } as unknown as JobRecord;
    },
    listSavedSearches: async () => [SEARCH],
    getResume: async () => 'resume',
    saveAnalysis: async () => undefined,
  };

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(result.inserted, 1);
  assert.equal(result.skipped, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0]?.jobUrl, 'https://race/2');
});

test('propagates non-duplicate insert errors', async () => {
  const deps: DiscoveryDeps = {
    source: { name: 'adzuna', search: async () => [sourced('https://boom/1')] },
    listJobs: async () => [],
    createJob: async () => {
      throw new Error('db down');
    },
    listSavedSearches: async () => [SEARCH],
    getResume: async () => 'resume',
    saveAnalysis: async () => undefined,
  };

  await assert.rejects(runDiscoveryForUser('u', deps), /db down/);
});

test('pre-ranks each inserted job with a local-prerank analysis', async () => {
  const { deps, analyses } = makeDeps(
    // Three recognised skills clears the local-fit evidence floor, so this
    // posting gets a real estimated number.
    [sourced('https://x/1', { descriptionText: 'We use TypeScript, React, and Node.js.' })],
    [],
  );

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(result.inserted, 1);
  assert.equal(analyses.length, 1);
  assert.equal(analyses[0]?.jobId, 'job-1');
  assert.equal(analyses[0]?.modelUsed, 'local-prerank');
  assert.equal(typeof analyses[0]?.fitScore, 'number');
});

test('pre-ranks a thin job-board snippet without inventing a score', async () => {
  // Adzuna returns 500-char snippets that typically parse to 0–1 skills. The
  // job is still ingested and analysed; only the fit number is withheld, so the
  // list renders "not scored" instead of a confident 0 or 100.
  const { deps, analyses } = makeDeps(
    [sourced('https://x/1', { descriptionText: 'Exciting AI Engineer role using LLM tooling.' })],
    [],
  );

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(result.inserted, 1);
  assert.equal(analyses[0]?.modelUsed, 'local-prerank');
  assert.equal(analyses[0]?.fitScore, null);
});

test('still counts an inserted job when pre-rank persistence fails (best-effort)', async () => {
  // saveAnalysis is opportunistic: the job is already inserted, so a transient
  // failure persisting the estimated fit must not abort the discovery run.
  const created: CreateJobBody[] = [];
  const deps: DiscoveryDeps = {
    source: { name: 'adzuna', search: async () => [sourced('https://x/1')] },
    listJobs: async () => [],
    createJob: async (_userId, body) => {
      created.push(body);
      return { ...(body as object), id: 'job-1' } as unknown as JobRecord;
    },
    listSavedSearches: async () => [SEARCH],
    getResume: async () => 'resume',
    saveAnalysis: async () => {
      throw new Error('analysis store unavailable');
    },
  };

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(result.inserted, 1);
  assert.equal(created.length, 1);
});

test('discovers jobs from enabled target company boards and deduplicates against saved-search jobs', async () => {
  const target: TargetCompany = {
    id: 'tc-1',
    userId: 'u',
    company: 'Acme',
    boardType: 'greenhouse',
    boardToken: 'acme',
    enabled: true,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };

  const searchJobs = [sourced('https://x/search-1')];
  const boardJobs: SourcedJob[] = [
    sourced('https://x/search-1', { source: 'greenhouse' }),
    sourced('https://x/board-unique', { source: 'greenhouse', title: 'Board Job' }),
  ];

  const created: CreateJobBody[] = [];
  let n = 0;
  const deps: DiscoveryDeps = {
    source: { name: 'adzuna', search: async () => searchJobs },
    listJobs: async () => [],
    createJob: async (_userId, body) => {
      created.push(body);
      n += 1;
      return { ...(body as object), id: `job-${n}` } as unknown as JobRecord;
    },
    listSavedSearches: async () => [SEARCH],
    getResume: async () => 'resume',
    saveAnalysis: async () => undefined,
    listTargetCompanies: async () => [target],
    fetchBoards: async () => boardJobs,
  };

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(result.inserted, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.source, 'adzuna+greenhouse');
  assert.equal(created.length, 2);
  assert.equal(created[0]?.jobUrl, 'https://x/search-1');
  assert.equal(created[1]?.jobUrl, 'https://x/board-unique');
});

test('does not call fetchBoards when targets are only disabled', async () => {
  const disabledTarget: TargetCompany = {
    id: 'tc-2',
    userId: 'u',
    company: 'DisabledCorp',
    boardType: 'lever',
    boardToken: 'disabled',
    enabled: false,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };

  let fetchBoardsCalled = false;
  const deps: DiscoveryDeps = {
    source: { name: 'adzuna', search: async () => [] },
    listJobs: async () => [],
    createJob: async () => ({ id: 'job-1' }) as unknown as JobRecord,
    listSavedSearches: async () => [SEARCH],
    getResume: async () => 'resume',
    saveAnalysis: async () => undefined,
    listTargetCompanies: async () => [disabledTarget],
    fetchBoards: async () => {
      fetchBoardsCalled = true;
      return [];
    },
  };

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(fetchBoardsCalled, false);
  assert.equal(result.source, 'adzuna');
});

test('handles multiple sources when the second throws: completes, inserts first jobs, source reflects only contributing one', async () => {
  const created: CreateJobBody[] = [];
  let n = 0;
  const src1 = {
    name: 'adzuna',
    search: async () => [sourced('https://x/1', { source: 'adzuna' })],
  };
  const src2 = {
    name: 'usajobs',
    search: async () => {
      throw new Error('USAJobs upstream failure');
    },
  };

  const deps: DiscoveryDeps = {
    sources: [src1, src2],
    listJobs: async () => [],
    createJob: async (_userId, body) => {
      created.push(body);
      n += 1;
      return { ...(body as object), id: `job-${n}` } as unknown as JobRecord;
    },
    listSavedSearches: async () => [SEARCH],
    getResume: async () => 'resume',
    saveAnalysis: async () => undefined,
  };

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(result.inserted, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.source, 'adzuna');
  assert.equal(created.length, 1);
  assert.equal(created[0]?.jobUrl, 'https://x/1');
});

test('deduplicates jobs across multiple sources by URL: duplicate URL inserts once', async () => {
  const created: CreateJobBody[] = [];
  let n = 0;
  const src1 = {
    name: 'adzuna',
    search: async () => [sourced('https://shared/1', { source: 'adzuna', title: 'Adzuna Version' })],
  };
  const src2 = {
    name: 'themuse',
    search: async () => [
      sourced('https://shared/1', { source: 'themuse', title: 'TheMuse Duplicate' }),
      sourced('https://unique/2', { source: 'themuse', title: 'TheMuse Unique' }),
    ],
  };

  const deps: DiscoveryDeps = {
    sources: [src1, src2],
    listJobs: async () => [],
    createJob: async (_userId, body) => {
      created.push(body);
      n += 1;
      return { ...(body as object), id: `job-${n}` } as unknown as JobRecord;
    },
    listSavedSearches: async () => [SEARCH],
    getResume: async () => 'resume',
    saveAnalysis: async () => undefined,
  };

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(result.inserted, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.source, 'adzuna+themuse');
  assert.equal(created.length, 2);
  assert.equal(created[0]?.jobUrl, 'https://shared/1');
  assert.equal(created[1]?.jobUrl, 'https://unique/2');
});

test('passes sponsorLikelihood to createJob when lookupSponsor returns a known sponsor', async () => {
  const { deps, created } = makeDeps([sourced('https://x/sponsor', { company: 'Acme Corp' })], []);
  deps.lookupSponsor = async (company: string) => {
    if (company === 'Acme Corp') {
      return { status: 'known_sponsor', approvals: 10, denials: 1 };
    }
    return null;
  };

  await runDiscoveryForUser('u', deps);

  assert.equal(created.length, 1);
  assert.deepEqual(created[0]?.sponsorLikelihood, {
    status: 'known_sponsor',
    approvals: 10,
    denials: 1,
  });
});

test('with DISCOVERY_JD_FETCH_CAP unset, calls upgradeJd stub exactly 25 times for 30 eligible snippet jobs', async () => {
  const originalEnv = process.env.DISCOVERY_JD_FETCH_CAP;
  delete process.env.DISCOVERY_JD_FETCH_CAP;

  try {
    const snippetJobs = Array.from({ length: 30 }, (_, i) =>
      sourced(`https://example.com/job/${i}`, {
        company: `Company ${i}`,
        title: `Engineer ${i}`,
        descriptionText: 'Short snippet description',
      }),
    );

    let upgradeCalls = 0;
    const { deps } = makeDeps(snippetJobs, []);
    deps.upgradeJd = async (job) => {
      upgradeCalls += 1;
      return { job, upgraded: false };
    };

    await runDiscoveryForUser('u', deps);

    assert.equal(upgradeCalls, 25);
  } finally {
    if (originalEnv !== undefined) {
      process.env.DISCOVERY_JD_FETCH_CAP = originalEnv;
    } else {
      delete process.env.DISCOVERY_JD_FETCH_CAP;
    }
  }
});

test('prerank runs on upgraded text so saveAnalysis receives non-null fitScore', async () => {
  // Original snippet has no catalog keywords -> prerank would produce null score.
  const snippetJob = sourced('https://example.com/job/prerank', {
    company: 'Upgraded Tech',
    title: 'Software Engineer',
    descriptionText: 'Just a brief snippet.',
  });

  // Resume has TypeScript, React, and Node.js
  const resume = 'Senior engineer with TypeScript, React, and Node.js experience.';
  const { deps, analyses } = makeDeps([snippetJob], [], resume);

  deps.upgradeJd = async (job) => {
    return {
      job: {
        ...job,
        descriptionText: 'Full JD: We use TypeScript, React, and Node.js daily to build products.',
      },
      upgraded: true,
    };
  };

  await runDiscoveryForUser('u', deps);

  assert.equal(analyses.length, 1);
  assert.notEqual(analyses[0]?.fitScore, null);
  assert.equal(analyses[0]?.fitScore, 100);
});

test('runDiscoveryForUser stops attempting JD upgrades when upgrade time budget is exhausted', async () => {
  const originalBudget = process.env.DISCOVERY_JD_UPGRADE_BUDGET_MS;
  process.env.DISCOVERY_JD_UPGRADE_BUDGET_MS = '0';

  try {
    const jobs: SourcedJob[] = Array.from({ length: 5 }, (_, i) => ({
      source: 'adzuna',
      company: `Company ${i}`,
      title: `Software Engineer ${i}`,
      descriptionText: 'Snippet',
      jobUrl: `https://example.com/job/${i}`,
    }));

    let upgradeCalls = 0;
    const { deps } = makeDeps(jobs, []);
    deps.upgradeJd = async (job) => {
      upgradeCalls += 1;
      return { job, upgraded: false };
    };

    await runDiscoveryForUser('u', deps);
    assert.equal(upgradeCalls, 0);
  } finally {
    if (originalBudget !== undefined) {
      process.env.DISCOVERY_JD_UPGRADE_BUDGET_MS = originalBudget;
    } else {
      delete process.env.DISCOVERY_JD_UPGRADE_BUDGET_MS;
    }
  }
});

test('when discovery re-encounters an existing job URL, touchSeen is called with that job ID', async () => {
  const existingJob = {
    id: 'existing-job-123',
    jobUrl: 'https://example.com/job/existing',
    company: 'Acme',
    title: 'Engineer',
    location: 'Remote',
  };

  const reEncountered = sourced('https://example.com/job/existing', {
    company: 'Acme',
    title: 'Engineer',
  });

  const touched: Array<{ userId: string; jobIds: string[] }> = [];
  const { deps } = makeDeps([reEncountered], [existingJob]);
  deps.touchSeen = async (userId, jobIds) => {
    touched.push({ userId, jobIds });
  };

  const result = await runDiscoveryForUser('user-1', deps);

  assert.equal(result.inserted, 0);
  assert.equal(result.skipped, 1);
  assert.deepEqual(touched, [{ userId: 'user-1', jobIds: ['existing-job-123'] }]);
});

test('touchSeen throwing an error does not fail the discovery run', async () => {
  const existingJob = {
    id: 'existing-job-123',
    jobUrl: 'https://example.com/job/existing',
    company: 'Acme',
    title: 'Engineer',
    location: 'Remote',
  };

  const reEncountered = sourced('https://example.com/job/existing', {
    company: 'Acme',
    title: 'Engineer',
  });

  const { deps } = makeDeps([reEncountered], [existingJob]);
  deps.touchSeen = async () => {
    throw new Error('Database connection failure during touchSeen');
  };

  const result = await runDiscoveryForUser('user-1', deps);

  assert.equal(result.inserted, 0);
  assert.equal(result.skipped, 1);
});

test('sequential scoring runs AI score when budget is available and saves sub-signals', async () => {
  const { deps, analyses } = makeDeps(
    [
      sourced('https://x/job-1', { title: 'Backend Engineer', descriptionText: 'TypeScript and Node.js role.' }),
      sourced('https://x/job-2', { title: 'Fullstack Engineer', descriptionText: 'React and Python role.' }),
    ],
    [],
  );

  const budgetCalls: Array<{ userId: string; op: string }> = [];
  deps.reserveBudget = async (userId, op) => {
    budgetCalls.push({ userId, op });
    return true;
  };

  const scoringCalls: Array<{ title?: string | null }> = [];
  deps.resolveFitScore = async (input) => {
    scoringCalls.push({ title: input.title });
    return {
      fit_score: 92,
      sub_signals: {
        skills_match: 95,
        title_seniority: 90,
        salary_fit: 85,
        sponsorship_likelihood: 100,
      },
      matched_skills: ['TypeScript'],
      missing_skills: [],
      ats_keywords: ['TypeScript', 'Node.js'],
      fit_summary: 'Strong fit for candidate skills.',
      recommended_resume_angle: 'Lead with backend Node.js work.',
      apply_recommendation: 'apply',
      confidence_score: 88,
      model_used: 'agent:gpt-5.6-luna',
    };
  };

  const result = await runDiscoveryForUser('user-1', deps);

  assert.equal(result.inserted, 2);
  assert.equal(budgetCalls.length, 2);
  assert.deepEqual(budgetCalls[0], { userId: 'user-1', op: 'score' });
  assert.deepEqual(budgetCalls[1], { userId: 'user-1', op: 'score' });

  assert.equal(scoringCalls.length, 2);
  assert.equal(scoringCalls[0]?.title, 'Backend Engineer');
  assert.equal(scoringCalls[1]?.title, 'Fullstack Engineer');

  assert.equal(analyses.length, 2);
  assert.equal(analyses[0]?.modelUsed, 'agent:gpt-5.6-luna');
  assert.equal(analyses[0]?.fitScore, 92);
  assert.deepEqual(analyses[0]?.subSignals, {
    skillsMatch: 95,
    titleSeniority: 90,
    salaryFit: 85,
    sponsorshipLikelihood: 100,
  });
  assert.equal(analyses[1]?.modelUsed, 'agent:gpt-5.6-luna');
});

test('sequential scoring falls back to local-prerank when budget is exhausted', async () => {
  const { deps, analyses } = makeDeps(
    [
      sourced('https://x/job-1', { title: 'Engineer 1', descriptionText: 'TypeScript React Node.js' }),
      sourced('https://x/job-2', { title: 'Engineer 2', descriptionText: 'TypeScript React Node.js' }),
    ],
    [],
  );

  let callCount = 0;
  deps.reserveBudget = async () => {
    callCount += 1;
    return callCount === 1; // 1st job succeeds, 2nd job is rejected due to budget limit
  };

  deps.resolveFitScore = async () => ({
    fit_score: 88,
    sub_signals: {
      skills_match: 90,
      title_seniority: 85,
      salary_fit: 80,
      sponsorship_likelihood: 90,
    },
    matched_skills: ['TypeScript'],
    missing_skills: [],
    ats_keywords: ['TypeScript'],
    fit_summary: 'Good match',
    recommended_resume_angle: 'Emphasize TS',
    apply_recommendation: 'apply',
    confidence_score: 80,
    model_used: 'agent:gpt-5.6-luna',
  });

  const result = await runDiscoveryForUser('user-1', deps);

  assert.equal(result.inserted, 2);
  assert.equal(analyses.length, 2);
  assert.equal(analyses[0]?.modelUsed, 'agent:gpt-5.6-luna');
  assert.equal(analyses[0]?.fitScore, 88);
  // Second job fell back to local-prerank gracefully
  assert.equal(analyses[1]?.modelUsed, 'local-prerank');
});

test('sequential scoring falls back to local-prerank when resolveFitScore throws', async () => {
  const { deps, analyses } = makeDeps(
    [sourced('https://x/job-1', { title: 'Engineer', descriptionText: 'TypeScript React Node.js' })],
    [],
  );

  deps.reserveBudget = async () => true;
  deps.resolveFitScore = async () => {
    throw new Error('agent container timeout');
  };

  const result = await runDiscoveryForUser('user-1', deps);

  assert.equal(result.inserted, 1);
  assert.equal(analyses.length, 1);
  assert.equal(analyses[0]?.modelUsed, 'local-prerank');
});

test('sequential scoring falls back to local-prerank when resolveFitScore hangs beyond timeout', async () => {
  const originalTimeout = process.env.DISCOVERY_AI_SCORE_TIMEOUT_MS;
  process.env.DISCOVERY_AI_SCORE_TIMEOUT_MS = '50';

  try {
    const { deps, analyses } = makeDeps(
      [sourced('https://x/job-timeout', { title: 'Engineer', descriptionText: 'TypeScript React Node.js' })],
      [],
    );

    deps.reserveBudget = async () => true;
    deps.resolveFitScore = async () => {
      // Hang indefinitely until test timeout if not bounded by discovery timeout
      await new Promise((resolve) => setTimeout(resolve, 500));
      return {
        fit_score: 90,
        sub_signals: {},
        matched_skills: [],
        missing_skills: [],
        ats_keywords: [],
        fit_summary: '',
        recommended_resume_angle: '',
        apply_recommendation: 'apply',
        confidence_score: 90,
        model_used: 'agent:gpt-5.6-luna',
      };
    };

    const result = await runDiscoveryForUser('user-1', deps);

    assert.equal(result.inserted, 1);
    assert.equal(analyses.length, 1);
    assert.equal(analyses[0]?.modelUsed, 'local-prerank');
  } finally {
    if (originalTimeout !== undefined) {
      process.env.DISCOVERY_AI_SCORE_TIMEOUT_MS = originalTimeout;
    } else {
      delete process.env.DISCOVERY_AI_SCORE_TIMEOUT_MS;
    }
  }
});

test('sequential scoring skips AI scoring entirely when sweep AI scoring budget is exhausted', async () => {
  const originalBudget = process.env.DISCOVERY_AI_SCORE_BUDGET_MS;
  // Expired budget: 0ms means remainingAiScoreBudgetMs <= 1000
  process.env.DISCOVERY_AI_SCORE_BUDGET_MS = '0';

  try {
    const { deps, analyses } = makeDeps(
      [sourced('https://x/job-expired-budget', { title: 'Engineer', descriptionText: 'TypeScript React Node.js' })],
      [],
    );

    let calledAi = false;
    deps.reserveBudget = async () => true;
    deps.resolveFitScore = async () => {
      calledAi = true;
      throw new Error('should not be called');
    };

    const result = await runDiscoveryForUser('user-1', deps);

    assert.equal(result.inserted, 1);
    assert.equal(calledAi, false);
    assert.equal(analyses.length, 1);
    assert.equal(analyses[0]?.modelUsed, 'local-prerank');
  } finally {
    if (originalBudget !== undefined) {
      process.env.DISCOVERY_AI_SCORE_BUDGET_MS = originalBudget;
    } else {
      delete process.env.DISCOVERY_AI_SCORE_BUDGET_MS;
    }
  }
});

