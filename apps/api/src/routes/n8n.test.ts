import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createN8nRouter } from './n8n';
import type { JobRecord } from '@/types';

function snapshotEnv(keys: string[]) {
  const snapshot = new Map<string, string | undefined>();

  for (const key of keys) {
    snapshot.set(key, process.env[key]);
  }

  return () => {
    for (const [key, value] of snapshot) {
      if (typeof value === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  const timestamp = '2026-05-17T12:00:00.000Z';

  return {
    id: 'job-1',
    jobUrl: 'https://example.com/jobs/ai-automation-engineer',
    source: 'n8n',
    company: 'Northwind Labs',
    title: 'AI Automation Engineer',
    location: 'Remote',
    employmentType: 'Full-time',
    workplaceType: 'remote',
    datePosted: '2026-05-14T09:00:00.000Z',
    discoveredAt: timestamp,
    descriptionText: 'Build internal automations using TypeScript, Azure Functions, and n8n.',
    status: 'discovered',
    priority: 'medium',
    fitScore: null,
    notes: undefined,
    nextAction: 'Run AI parsing and fit scoring after the record is saved.',
    nextActionDue: undefined,
    analysis: {
      requiredSkills: ['TypeScript', 'Azure Functions'],
      preferredSkills: ['n8n'],
      matchedSkills: [],
      missingSkills: ['TypeScript', 'Azure Functions'],
      atsKeywords: ['TypeScript', 'Azure Functions', 'n8n'],
      fitSummary: 'Initial placeholder analysis waiting for AI processing.',
      recommendedResumeAngle: 'Emphasize truthful, relevant experience from the current resume.',
      applyRecommendation: 'Review manually before deciding whether to apply.',
      confidenceScore: 48,
      modelUsed: 'mock-analysis-v1',
    },
    outreach: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

interface N8nJobIntakeResponse {
  workflow: string;
  job: {
    id: string;
    nextAction: string;
  };
  parsed: unknown;
  fit_status: 'skipped' | 'scored';
  fit_message: string;
  notification: string;
}

interface N8nFollowUpRemindersResponse {
  workflow: string;
  generated_at: string;
  reminder_count: number;
  reminders: Array<{
    jobId: string;
  }>;
  notification: string;
}

interface N8nWeeklyReportResponse {
  workflow: string;
  email_subject: string;
  notification: string;
}

async function withServer(
  router: ReturnType<typeof createN8nRouter>,
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  app.use('/api/n8n', router);

  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Test server did not provide a usable address');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('rejects n8n webhooks without the shared secret', async () => {
  const restore = snapshotEnv(['N8N_WEBHOOK_SECRET']);
  process.env.N8N_WEBHOOK_SECRET = 'n8n-secret';

  try {
    await withServer(
      createN8nRouter({
        createJob: async () => makeJob(),
        listJobs: async () => [],
        saveJobAnalysis: async () => makeJob(),
        updateJob: async () => makeJob(),
      }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/n8n/weekly-report`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            week_start: '2026-05-11',
            week_end: '2026-05-17',
          }),
        });

        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), {
          error: 'Missing or invalid n8n webhook secret',
        });
      },
    );
  } finally {
    restore();
  }
});

test('creates and enriches a job-intake webhook payload', async () => {
  const restore = snapshotEnv(['N8N_WEBHOOK_SECRET']);
  process.env.N8N_WEBHOOK_SECRET = 'n8n-secret';

  let createdJobBody: unknown;
  let savedAnalysis: unknown;
  let savedFitScore: number | null | undefined;
  let updatedJobBody: unknown;

  const createdJob = makeJob({ id: 'job-2' });
  const scoredJob = makeJob({
    id: 'job-2',
    status: 'discovered',
    fitScore: 91,
    analysis: {
      requiredSkills: ['TypeScript', 'Azure Functions', 'n8n'],
      preferredSkills: ['PostgreSQL'],
      matchedSkills: ['TypeScript', 'n8n'],
      missingSkills: ['Azure Functions'],
      atsKeywords: ['TypeScript', 'Azure Functions', 'n8n', 'PostgreSQL'],
      fitSummary: 'Matched core automation skills and should stay a human-reviewed shortlist.',
      recommendedResumeAngle: 'Lead with truthful automation and serverless delivery examples.',
      applyRecommendation: 'Apply with a customized resume and a short human-reviewed outreach message.',
      confidenceScore: 90,
      modelUsed: 'mock-fit-scorer-v1',
    },
    nextAction: 'Review the AI analysis and decide whether to shortlist.',
  });

  try {
    await withServer(
      createN8nRouter({
        createJob: async (body) => {
          createdJobBody = body;
          return createdJob;
        },
        listJobs: async () => [],
        saveJobAnalysis: async (_jobId, analysis, fitScore) => {
          savedAnalysis = analysis;
          savedFitScore = fitScore;
          return scoredJob;
        },
        updateJob: async (_jobId, body) => {
          updatedJobBody = body;
          return scoredJob;
        },
      }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/n8n/job-intake`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-N8N-Webhook-Secret': 'n8n-secret',
          },
          body: JSON.stringify({
            company: 'Northwind Labs',
            title: 'AI Automation Engineer',
            description_text: 'Build internal automations using TypeScript, Azure Functions, and n8n.',
            job_url: 'https://example.com/jobs/ai-automation-engineer',
            source: 'job board',
            resume_text: 'TypeScript, Azure Functions, and n8n experience',
            profile_text: 'workflow automation and serverless delivery',
          }),
        });

        assert.equal(response.status, 201);

        const payload = (await response.json()) as N8nJobIntakeResponse;
        assert.equal(payload.workflow, 'job-intake');
        assert.equal(payload.fit_status, 'scored');
        assert.match(payload.fit_message, /Fit scoring completed with a score of/);
        assert.match(payload.notification, /queued for human review/);
        assert.equal(payload.job.id, 'job-2');
        assert.equal(payload.job.nextAction, 'Review the AI analysis and decide whether to shortlist.');
        assert.deepEqual(createdJobBody, {
          jobUrl: 'https://example.com/jobs/ai-automation-engineer',
          source: 'job board',
          company: 'Northwind Labs',
          title: 'AI Automation Engineer',
          location: undefined,
          employmentType: undefined,
          workplaceType: undefined,
          datePosted: undefined,
          priority: undefined,
          notes: undefined,
          descriptionText: 'Build internal automations using TypeScript, Azure Functions, and n8n.',
        });
        assert.ok(savedAnalysis);
        assert.equal(savedFitScore, 82);
        assert.deepEqual(updatedJobBody, {
          nextAction: 'Review the AI analysis and decide whether to shortlist.',
        });
      },
    );
  } finally {
    restore();
  }
});

test('returns a dedupe response when the webhook payload already exists', async () => {
  const restore = snapshotEnv(['N8N_WEBHOOK_SECRET']);
  process.env.N8N_WEBHOOK_SECRET = 'n8n-secret';

  try {
    await withServer(
      createN8nRouter({
        createJob: async () => {
          throw new Error('createJob should not be called for duplicates');
        },
        listJobs: async () => [
          makeJob({
            id: 'existing-job',
            jobUrl: 'https://example.com/jobs/ai-automation-engineer',
          }),
        ],
        saveJobAnalysis: async () => makeJob(),
        updateJob: async () => makeJob(),
      }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/n8n/job-intake`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-N8N-Webhook-Secret': 'n8n-secret',
          },
          body: JSON.stringify({
            company: 'Northwind Labs',
            title: 'AI Automation Engineer',
            description_text: 'Build internal automations using TypeScript, Azure Functions, and n8n.',
            job_url: 'https://example.com/jobs/ai-automation-engineer',
          }),
        });

        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), {
          error: 'A job with this URL already exists.',
          fields: {
            job_url: 'A job with this URL already exists.',
          },
          existing_job_id: 'existing-job',
        });
      },
    );
  } finally {
    restore();
  }
});

test('returns due follow-up reminders and weekly report drafts', async () => {
  const restore = snapshotEnv(['N8N_WEBHOOK_SECRET']);
  process.env.N8N_WEBHOOK_SECRET = 'n8n-secret';

  try {
    await withServer(
      createN8nRouter({
        createJob: async () => makeJob(),
        listJobs: async () => [
          makeJob({
            id: 'due-job',
            status: 'follow_up_due',
            nextActionDue: '2026-05-16T09:00:00.000Z',
            nextAction: 'Send a follow-up note.',
            outreach: [],
          }),
          makeJob({
            id: 'archived-job',
            status: 'archived',
            nextActionDue: '2026-05-15T09:00:00.000Z',
          }),
          makeJob({
            id: 'future-job',
            status: 'outreach_sent',
            nextActionDue: '2026-05-20T09:00:00.000Z',
          }),
        ],
        saveJobAnalysis: async () => makeJob(),
        updateJob: async () => makeJob(),
      }),
      async (baseUrl) => {
        const remindersResponse = await fetch(`${baseUrl}/api/n8n/follow-up-reminders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-N8N-Webhook-Secret': 'n8n-secret',
          },
          body: JSON.stringify({
            as_of: '2026-05-17T09:00:00.000Z',
          }),
        });

        assert.equal(remindersResponse.status, 200);
        const remindersPayload = (await remindersResponse.json()) as N8nFollowUpRemindersResponse;
        assert.equal(remindersPayload.workflow, 'follow-up-reminders');
        assert.equal(remindersPayload.reminder_count, 1);
        const [firstReminder] = remindersPayload.reminders;
        assert.ok(firstReminder);
        assert.equal(firstReminder.jobId, 'due-job');
        assert.match(remindersPayload.notification, /1 follow-up reminder/);

        const reportResponse = await fetch(`${baseUrl}/api/n8n/weekly-report`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-N8N-Webhook-Secret': 'n8n-secret',
          },
          body: JSON.stringify({
            week_start: '2026-05-11',
            week_end: '2026-05-17',
          }),
        });

        assert.equal(reportResponse.status, 200);
        const reportPayload = (await reportResponse.json()) as N8nWeeklyReportResponse;
        assert.equal(reportPayload.workflow, 'weekly-report');
        assert.equal(reportPayload.email_subject, 'Weekly report summary for 2026-05-11 to 2026-05-17');
        assert.match(reportPayload.notification, /email delivery/);
      },
    );
  } finally {
    restore();
  }
});
