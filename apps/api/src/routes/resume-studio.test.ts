import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { createJob, resetJobStoreForTests } from '@/data/job-store';
import { insertResumeVersion, resetResumeVersionStore } from '@/data/resume-version-store';
import { upsertUserProfile } from '@/data/profile-store';
import { apiErrorHandler } from '@/lib/api-error-handler';
import { resumeStudioRouter } from './resume-studio';
import { TAILOR_BASE, edit, emptyAnswer } from '@/test-support/tailor-fixtures';
import type { TailorAgentRequest, TailorAnswer } from '@/lib/tailor/answer';
import type { ResumeVersionRecord, StructuredResume } from '@/types';

/**
 * POST /api/jobs/:id/tailor (#351): the AI suggests edits to lines of the base résumé, the
 * API applies the ones its grounding check accepts, and the draft records what it was based
 * on. A fake agent answers like the real one.
 */

const POSTING = 'Acme Pay is hiring a backend engineer to build payment APIs in Go. Kafka is a plus.';

type Send = (method: string, path: string, body?: unknown, user?: string) => Promise<Response>;

interface Agent {
  calls: Array<{ path: string; body: TailorAgentRequest }>;
}

/** A store in a temp dir, a fake agent answering `answer`, and the studio router. */
async function withStudio(
  answer: unknown,
  run: (ctx: { agent: Agent; send: Send }) => Promise<void>,
  options: { agentDown?: boolean } = {},
) {
  const originalCwd = process.cwd();
  const originalAgent = process.env.AGENT_SERVICE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-studio-'));
  delete process.env.DATABASE_URL;
  process.chdir(tempDir);
  await resetJobStoreForTests();
  await resetResumeVersionStore();

  const agent: Agent = { calls: [] };
  const agentServer = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      agent.calls.push({ path: request.url ?? '', body: JSON.parse(raw || '{}') as TailorAgentRequest });
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer));
    });
  });
  await new Promise<void>((resolve) => agentServer.listen(0, resolve));
  const agentAddress = agentServer.address();
  if (!agentAddress || typeof agentAddress === 'string') throw new Error('no agent address');
  process.env.AGENT_SERVICE_URL = options.agentDown ? 'http://127.0.0.1:9' : `http://127.0.0.1:${agentAddress.port}`;

  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    const header = request.header('X-User-Id');
    if (header) request.userId = header.trim();
    next();
  });
  app.use('/api', resumeStudioRouter);
  app.use(apiErrorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  const send: Send = (method, path, body, user = 'user-studio') =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: { 'X-User-Id': user, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  try {
    await run({ agent, send });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    agentServer.closeAllConnections();
    await new Promise<void>((resolve) => agentServer.close(() => resolve()));
    process.chdir(originalCwd);
    if (originalAgent === undefined) delete process.env.AGENT_SERVICE_URL;
    else process.env.AGENT_SERVICE_URL = originalAgent;
    await resetJobStoreForTests();
    await resetResumeVersionStore();
    await rm(tempDir, { recursive: true, force: true });
  }
}

const answerWith = (overrides: Partial<TailorAnswer>) => ({ ...emptyAnswer(overrides), model_used: 'openai:gpt-6-luna' });

async function setUp(resume: StructuredResume | null = TAILOR_BASE, descriptionText = POSTING, user = 'user-studio') {
  const job = await createJob(user, { company: 'Acme Pay Inc.', title: 'Backend Engineer', descriptionText });
  if (resume) await upsertUserProfile(user, { baseResume: resume });
  return job;
}

async function versionsOf(send: Send, jobId: string): Promise<ResumeVersionRecord[]> {
  return ((await (await send('GET', `/api/jobs/${jobId}/resume-versions`)).json()) as { versions: ResumeVersionRecord[] }).versions;
}

async function tailor(send: Send, jobId: string, body: unknown = {}): Promise<ResumeVersionRecord> {
  const response = await send('POST', `/api/jobs/${jobId}/tailor`, body);
  assert.equal(response.status, 201);
  return ((await response.json()) as { version: ResumeVersionRecord }).version;
}

test('tailoring applies the checked edits and records what the draft was based on', async () => {
  const answer = answerWith({
    edits: [
      edit('basics.summary', 'Backend engineer who builds payment APIs in Go, with PostgreSQL in production.'),
      edit('work[0].highlights[1]', 'Cut p95 latency 40% with Redis caching'),
    ],
    highlight_orders: [{ work_index: 0, highlight_order: [1, 0, 2, 3, 4] }],
    gaps: ['Kafka streaming', 'Advanced SQL'],
  });
  await withStudio(answer, async ({ agent, send }) => {
    const job = await setUp();
    const response = await send('POST', `/api/jobs/${job.id}/tailor`, {});
    assert.equal(response.status, 201);
    const { status, version } = (await response.json()) as { status: string; version: ResumeVersionRecord };
    assert.equal(status, 'awaiting_approval');
    assert.equal(version.approved, false);

    // What the agent was sent: the posting, the editable lines by path, the facts.
    assert.equal(agent.calls.length, 1);
    const sent = agent.calls[0]!;
    assert.equal(sent.path, '/tailor-resume');
    assert.equal(sent.body.description_text, POSTING);
    assert.equal(sent.body.company, 'Acme Pay Inc.');
    assert.deepEqual(
      sent.body.lines.map((line) => line.path).slice(0, 3),
      ['basics.summary', 'work[0].highlights[0]', 'work[0].highlights[1]'],
    );
    assert.match(sent.body.facts, /work\[0\]: Backend Engineer, Globex \(2022-01-01 – present\)/);
    assert.doesNotMatch(sent.body.facts, /jordan@example\.com/, 'contact details are not sent');
    assert.deepEqual(sent.body.skills, ['Go', 'Python', 'SQL', 'PostgreSQL', 'Docker']);
    assert.deepEqual(sent.body.skill_categories, ['Languages', 'Infrastructure']);
    assert.deepEqual(sent.body.confirmed_keywords, []);

    // At least one change outside the summary, each with its source.
    const rewrites = (version.changeDetails ?? []).filter((d) => d.kind === 'rewrite');
    assert.ok(rewrites.some((d) => d.sourcePath !== 'basics.summary'));
    for (const detail of rewrites) {
      assert.ok(detail.oldText && detail.newText && detail.rationale && detail.sourcePath, JSON.stringify(detail));
    }
    assert.equal(version.structuredResume.work[0]!.highlights[0], 'Cut p95 latency 40% with Redis caching');
    assert.equal(version.structuredResume.work[0]!.company, 'Globex');
    assert.equal(version.changeSummary, 'Reworded 2 lines and reordered bullets in 1 role.');

    const basedOn = version.basedOn!;
    assert.equal(basedOn.jobId, job.id);
    assert.equal(basedOn.model, 'openai:gpt-6-luna');
    assert.equal(basedOn.postingSha256, createHash('sha256').update(POSTING).digest('hex'));
    assert.deepEqual(basedOn.grounding, { version: 1 });
    assert.deepEqual(basedOn.gaps, ['Kafka streaming']);
    assert.deepEqual(basedOn.confirmedKeywords, []);

    const saved = await versionsOf(send, job.id);
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0]!.basedOn, basedOn);
  });
});

test('a suggestion that adds a skill is dropped and shown, and the download keeps the base line', async () => {
  const answer = answerWith({
    edits: [
      edit('work[0].highlights[0]', 'Built the billing API in Go and Kafka serving 2,000 merchants'),
      edit('work[0].highlights[1]', 'Cut p95 latency 40% with Redis caching'),
    ],
  });
  await withStudio(answer, async ({ send }) => {
    const job = await setUp();
    const version = await tailor(send, job.id);
    const kafka = version.changeDetails!.find((d) => d.sourcePath === 'work[0].highlights[0]')!;
    assert.equal(kafka.dropped, true);
    assert.match(kafka.dropReason!, /Kafka/);
    assert.equal(version.structuredResume.work[0]!.highlights[0], TAILOR_BASE.work[0]!.highlights[0]);
    assert.match(version.changeSummary, /1 suggestion was dropped/);

    // Approve still works: the dropped line isn't in the résumé.
    assert.equal((await send('POST', `/api/resume-versions/${version.id}/approve`, {})).status, 200);
    const download = await send('GET', `/api/resume-versions/${version.id}/download`);
    assert.equal(download.status, 200);
    // The PDF's text operators: pdf.js can't open this writer's files ("bad XRef entry"),
    // which L01 (#352) fixes when it replaces the writer.
    const pdf = Buffer.from(await download.arrayBuffer()).toString('latin1');
    assert.match(pdf, /Cut p95 latency 40% with Redis caching\) Tj/);
    assert.match(pdf, /Built the billing API in Go serving 2,000 merchants\) Tj/);
    assert.doesNotMatch(pdf, /Kafka/);
  });
});

test('confirmed keywords are sent, added to the skills, and may be used in a line', async () => {
  const answer = answerWith({
    edits: [edit('work[0].highlights[0]', 'Built the billing API in Go and Kafka serving 2,000 merchants')],
    added_skills: [{ skill: 'Kafka', category: 'Infrastructure' }],
    gaps: ['Kafka', 'Kubernetes'],
  });
  await withStudio(answer, async ({ agent, send }) => {
    const job = await setUp();
    const version = await tailor(send, job.id, { confirmedKeywords: [' Kafka ', 'kafka'] });
    assert.deepEqual(agent.calls[0]!.body.confirmed_keywords, ['Kafka']);
    assert.equal(version.structuredResume.work[0]!.highlights[0], 'Built the billing API in Go and Kafka serving 2,000 merchants');
    assert.deepEqual(version.structuredResume.skills[1]!.skills, ['PostgreSQL', 'Docker', 'Kafka']);
    const line = version.changeDetails!.find((d) => d.kind === 'rewrite')!;
    assert.deepEqual(line.confirmedTerms, ['Kafka']);
    assert.deepEqual(version.basedOn!.confirmedKeywords, ['Kafka']);
    assert.deepEqual(version.basedOn!.gaps, ['Kubernetes']);
  });
});

test('confirmed keywords must be a short list of short words', async () => {
  await withStudio(answerWith({}), async ({ agent, send }) => {
    const job = await setUp();
    for (const confirmedKeywords of ['Kafka', [1], [' '], ['x'.repeat(61)], Array.from({ length: 26 }, (_v, i) => `k${i}`)]) {
      const response = await send('POST', `/api/jobs/${job.id}/tailor`, { confirmedKeywords });
      assert.equal(response.status, 400, JSON.stringify(confirmedKeywords).slice(0, 40));
    }
    assert.equal(agent.calls.length, 0);
  });
});

test('an empty base résumé or posting is a 409, and the AI is not called', async () => {
  await withStudio(answerWith({}), async ({ agent, send }) => {
    const noResume = await setUp(null, POSTING, 'user-none');
    const empty = await setUp(
      { ...TAILOR_BASE, basics: { ...TAILOR_BASE.basics, summary: '' }, work: [] },
      POSTING,
      'user-empty',
    );
    for (const [user, jobId] of [['user-none', noResume.id], ['user-empty', empty.id]] as const) {
      const response = await send('POST', `/api/jobs/${jobId}/tailor`, {}, user);
      assert.equal(response.status, 409);
      const body = (await response.json()) as { code: string; error: string };
      assert.equal(body.code, 'BASE_RESUME_EMPTY');
      assert.match(body.error, /Settings → Résumé/);
    }
    const noPosting = await setUp(TAILOR_BASE, '   ', 'user-noposting');
    const response = await send('POST', `/api/jobs/${noPosting.id}/tailor`, {}, 'user-noposting');
    assert.equal(response.status, 409);
    assert.equal(((await response.json()) as { code: string }).code, 'POSTING_EMPTY');
    assert.equal((await send('POST', '/api/jobs/no-such-job/tailor', {})).status, 404);
    assert.equal(agent.calls.length, 0);
  });
});

test('when the AI is down, unusable or suggests nothing: 503 retryable, and no version is saved', async () => {
  const cases: Array<[string, unknown, boolean]> = [
    ['down', {}, true],
    ['edits not a list', { ...answerWith({}), edits: 'none' }, false],
    ['no model', emptyAnswer(), false],
    ['nothing suggested', answerWith({}), false],
  ];
  for (const [label, answer, agentDown] of cases) {
    await withStudio(
      answer,
      async ({ send }) => {
        const job = await setUp();
        const response = await send('POST', `/api/jobs/${job.id}/tailor`, {});
        const body = (await response.json()) as { retryable?: boolean; error?: string };
        assert.equal(response.status, 503, `${label}: ${JSON.stringify(body)}`);
        assert.equal(body.retryable, true, label);
        assert.deepEqual(await versionsOf(send, job.id), [], `${label}: nothing saved`);
      },
      { agentDown },
    );
  }
});

test('an empty base summary stays empty (no "undefined")', async () => {
  const answer = answerWith({ edits: [edit('work[0].highlights[2]', 'Mentored 2 interns')] });
  await withStudio(answer, async ({ agent, send }) => {
    const job = await setUp({ ...TAILOR_BASE, basics: { ...TAILOR_BASE.basics, summary: '' } });
    const version = await tailor(send, job.id);
    assert.equal(version.structuredResume.basics.summary, '');
    assert.ok(!agent.calls[0]!.body.lines.some((line) => line.path === 'basics.summary'));
  });
});

test("approve and download need the API's check; download needs approval; base versions aren't drafts", async () => {
  await withStudio(answerWith({ edits: [edit('work[0].highlights[2]', 'Mentored 2 interns')] }), async ({ send }) => {
    const job = await setUp();
    const legacy: ResumeVersionRecord = {
      id: randomUUID(),
      userId: 'user-studio',
      jobId: job.id,
      changeSummary: 'Tailored resume draft',
      structuredResume: TAILOR_BASE,
      approved: true,
      isBase: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await insertResumeVersion(legacy);
    for (const [method, path] of [
      ['POST', `/api/resume-versions/${legacy.id}/approve`],
      ['GET', `/api/resume-versions/${legacy.id}/download`],
    ] as const) {
      const response = await send(method, path, method === 'POST' ? {} : undefined);
      assert.equal(response.status, 422, `${method} ${path}`);
      assert.equal(((await response.json()) as { code: string }).code, 'NOT_GROUNDED');
    }

    const version = await tailor(send, job.id);
    const early = await send('GET', `/api/resume-versions/${version.id}/download`);
    assert.equal(early.status, 409);
    assert.equal(((await early.json()) as { code: string }).code, 'NOT_APPROVED');
    const approved = await send('POST', `/api/resume-versions/${version.id}/approve`, {});
    assert.equal(approved.status, 200);
    assert.equal(((await approved.json()) as { version: ResumeVersionRecord }).version.approved, true);
    assert.equal((await send('GET', `/api/resume-versions/${version.id}/download`)).status, 200);

    const baseVersion: ResumeVersionRecord = { ...legacy, id: randomUUID(), jobId: null, isBase: true };
    await insertResumeVersion(baseVersion);
    assert.equal((await send('POST', `/api/resume-versions/${baseVersion.id}/approve`, {})).status, 404);
    assert.equal((await send('GET', `/api/resume-versions/${baseVersion.id}/download`)).status, 404);
    // Another user's draft is not found.
    assert.equal((await send('POST', `/api/resume-versions/${version.id}/approve`, {}, 'someone-else')).status, 404);
  });
});

test('reject records the feedback on the draft', async () => {
  await withStudio(answerWith({ edits: [edit('work[0].highlights[2]', 'Mentored 2 interns')] }), async ({ send }) => {
    const job = await setUp();
    const version = await tailor(send, job.id);
    const response = await send('POST', `/api/resume-versions/${version.id}/reject`, { feedback: 'Lead with Go.' });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { approved: boolean; version: ResumeVersionRecord };
    assert.equal(body.approved, false);
    assert.match(body.version.changeSummary, /Lead with Go\./);
  });
});

test('the approved PDF link points at the draft download, which works', async () => {
  const savedStorage = process.env.AZURE_STORAGE_CONNECTION_STRING;
  delete process.env.AZURE_STORAGE_CONNECTION_STRING;
  try {
    await withStudio(answerWith({ edits: [edit('work[0].highlights[2]', 'Mentored 2 interns')] }), async ({ send }) => {
      const job = await setUp();
      const version = await tailor(send, job.id);
      const approved = (await (await send('POST', `/api/resume-versions/${version.id}/approve`, {})).json()) as {
        fileUrl: string;
      };
      const path = new URL(approved.fileUrl).pathname;
      assert.equal(path, `/api/resume-versions/${version.id}/download`);
      assert.equal((await send('GET', path)).status, 200);
    });
  } finally {
    if (savedStorage !== undefined) process.env.AZURE_STORAGE_CONNECTION_STRING = savedStorage;
  }
});

test('an answer with nothing from the AI is a 503 even with confirmed keywords, and saves nothing', async () => {
  await withStudio(answerWith({}), async ({ send }) => {
    const job = await setUp();
    const response = await send('POST', `/api/jobs/${job.id}/tailor`, { confirmedKeywords: ['Kafka'] });
    assert.equal(response.status, 503);
    assert.deepEqual(await versionsOf(send, job.id), []);
  });
});

test('a posting the agent refused as a prompt injection is a 422 to fix the posting, not a retry', async () => {
  // The agent's answer when INJECTION_ACTION=refuse (services/agent/app/chains/tailor_resume.py).
  const refused = answerWith({ change_summary: 'Not tailored: suspected prompt injection in the posting.' });
  await withStudio(refused, async ({ send }) => {
    const job = await setUp();
    const response = await send('POST', `/api/jobs/${job.id}/tailor`, { confirmedKeywords: ['Kafka'] });
    assert.equal(response.status, 422);
    const body = (await response.json()) as { code: string; error: string };
    assert.equal(body.code, 'POSTING_REFUSED');
    assert.match(body.error, /instructions/);
    assert.deepEqual(await versionsOf(send, job.id), []);
  });
});

test('confirmed keywords with control characters are refused before the AI is called', async () => {
  await withStudio(answerWith({}), async ({ agent, send }) => {
    const job = await setUp();
    for (const keyword of ['Kafka\u0000', 'Kafka\nJava', 'Ka\u0007fka', 'Kafka\u0085', 'Kafka\u2028', 'Kafka\u202e', 'Kafka\ud800']) {
      const response = await send('POST', `/api/jobs/${job.id}/tailor`, { confirmedKeywords: [keyword] });
      assert.equal(response.status, 400, JSON.stringify(keyword));
    }
    assert.equal(agent.calls.length, 0);
  });
});

test('a draft for a name outside Latin-1 downloads, with the name kept in the file name', async () => {
  await withStudio(answerWith({ edits: [edit('work[0].highlights[2]', 'Mentored 2 interns')] }), async ({ send }) => {
    const job = await setUp({ ...TAILOR_BASE, basics: { ...TAILOR_BASE.basics, name: 'Łukasz Żółć 李' } });
    const version = await tailor(send, job.id);
    assert.equal((await send('POST', `/api/resume-versions/${version.id}/approve`, {})).status, 200);
    const download = await send('GET', `/api/resume-versions/${version.id}/download`);
    assert.equal(download.status, 200);
    const disposition = download.headers.get('content-disposition') ?? '';
    assert.match(disposition, /^attachment; filename="[\x20-\x7e]+\.pdf"; filename\*=UTF-8''/);
    assert.ok(decodeURIComponent(disposition.split("UTF-8''")[1]!).startsWith('Łukasz_Żółć_李_'));
  });
});
