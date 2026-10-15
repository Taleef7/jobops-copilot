import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { createJob, resetJobStoreForTests, saveJobAnalysis } from '@/data/job-store';
import { insertResumeVersion, resetResumeVersionStore } from '@/data/resume-version-store';
import { getUserProfile, upsertUserProfile } from '@/data/profile-store';
import { sampleAnalysis } from '@/test-support/analysis';
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
  // duringAgent runs while the AI call is in flight, before the fake agent answers.
  options: { agentDown?: boolean; duringAgent?: () => Promise<void> } = {},
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
      void Promise.resolve(options.duringAgent?.()).then(() =>
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer)),
      );
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

// #351 step 4: the review keeps, restores or edits each line, and Download is the approval.
// Reject (with feedback) is gone.
test('there is no reject any more', async () => {
  await withStudio(answerWith({ edits: [edit('work[0].highlights[2]', 'Mentored 2 interns')] }), async ({ send }) => {
    const job = await setUp();
    const version = await tailor(send, job.id);
    assert.equal((await send('POST', `/api/resume-versions/${version.id}/reject`, { feedback: 'x' })).status, 404);
  });
});

test('the tailor window lists the posting keywords and which are on the résumé', async () => {
  await withStudio(answerWith({}), async ({ send }) => {
    const job = await setUp();
    const before = (await (await send('GET', `/api/jobs/${job.id}/tailor/keywords`)).json()) as {
      fitRead: boolean;
      keywords: unknown[];
    };
    assert.deepEqual(before, { fitRead: false, keywords: [] });

    await saveJobAnalysis('user-studio', job.id, sampleAnalysis(), 70);
    const response = await send('GET', `/api/jobs/${job.id}/tailor/keywords`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      fitRead: true,
      keywords: [
        { term: 'Go', onResume: true },
        { term: 'Postgres', onResume: true },
        { term: 'Kafka', onResume: false },
      ],
    });
    assert.equal((await send('GET', `/api/jobs/${job.id}/tailor/keywords`, undefined, 'someone-else')).status, 404);

    // Requirements written as phrases aren't keywords to confirm: they'd land in the skills.
    await saveJobAnalysis(
      'user-studio',
      job.id,
      sampleAnalysis({ requiredSkills: ['Go', '3+ years of backend development experience', 'Kafka or another streaming platform'] }),
      70,
    );
    const filtered = (await (await send('GET', `/api/jobs/${job.id}/tailor/keywords`)).json()) as { keywords: Array<{ term: string }> };
    assert.deepEqual(filtered.keywords.map((k) => k.term), ['Go', 'Kafka', 'Postgres']);
  });
});

test('a draft records how many posting keywords the résumé has, before and after', async () => {
  const answer = answerWith({ added_skills: [{ skill: 'Kafka', category: 'Infrastructure' }], edits: [edit('work[0].highlights[2]', 'Mentored 2 interns')] });
  await withStudio(answer, async ({ send }) => {
    const job = await setUp();
    await saveJobAnalysis('user-studio', job.id, sampleAnalysis(), 70);
    const version = await tailor(send, job.id, { confirmedKeywords: ['Kafka'] });
    assert.deepEqual(version.basedOn!.coverage, { total: 3, before: 2, after: 3, terms: ['Go', 'Postgres', 'Kafka'] });
  });
});

test('confirmed keywords can be added to the base résumé too', async () => {
  const answer = answerWith({ edits: [edit('work[0].highlights[2]', 'Mentored 2 interns')] });
  await withStudio(answer, async ({ send }) => {
    const job = await setUp();
    const response = await send('POST', `/api/jobs/${job.id}/tailor`, { confirmedKeywords: ['Kafka', 'Go'], addToBase: true });
    assert.equal(response.status, 201);
    assert.equal(((await response.json()) as { addedToBase: boolean }).addedToBase, true);
    const profile = await getUserProfile('user-studio');
    assert.deepEqual(profile?.baseResume?.skills, [
      { category: 'Languages', skills: ['Go', 'Python', 'SQL'] },
      { category: 'Infrastructure', skills: ['PostgreSQL', 'Docker'] },
      { category: 'Other', skills: ['Kafka'] },
    ]);
    assert.equal((await send('POST', `/api/jobs/${job.id}/tailor`, { addToBase: 'yes' })).status, 400);
  });
});

test('each line of a draft can be kept, restored or edited until it is downloaded', async () => {
  const answer = answerWith({
    edits: [
      edit('work[0].highlights[1]', 'Cut p95 latency 40% with Redis caching'),
      edit('work[0].highlights[0]', 'Built the billing API in Go and Kafka serving 2,000 merchants'),
    ],
  });
  await withStudio(answer, async ({ send }) => {
    const job = await setUp();
    const version = await tailor(send, job.id, { confirmedKeywords: ['Snowflake'] });
    const [reworded, dropped] = version.changeDetails!;
    const added = version.changeDetails!.find((d) => d.kind === 'skill-added')!;
    const act = (changeId: string, body: unknown, user?: string) =>
      send('PATCH', `/api/resume-versions/${version.id}/changes/${changeId}`, body, user);
    const read = async (response: Response) => ((await response.json()) as { version: ResumeVersionRecord }).version;

    // Restore: the base line comes back.
    let updated = await read(await act(reworded!.id!, { action: 'restore' }));
    assert.equal(updated.structuredResume.work[0]!.highlights[1], TAILOR_BASE.work[0]!.highlights[1]);
    assert.equal(updated.changeDetails![0]!.resolution, 'restored');
    // Keep: back to the suggestion.
    updated = await read(await act(reworded!.id!, { action: 'keep' }));
    assert.equal(updated.structuredResume.work[0]!.highlights[1], 'Cut p95 latency 40% with Redis caching');
    assert.equal(updated.changeDetails![0]!.resolution, 'kept');
    // Edit: the user's own words, even for a dropped suggestion; marked as theirs.
    updated = await read(await act(dropped!.id!, { action: 'edit', text: '  Built the billing API in Go for 2,000 merchants ' }));
    assert.equal(updated.structuredResume.work[0]!.highlights[0], 'Built the billing API in Go for 2,000 merchants');
    assert.equal(updated.changeDetails![1]!.resolution, 'edited');
    assert.equal(updated.changeDetails![1]!.userText, 'Built the billing API in Go for 2,000 merchants');
    // Restore an added skill: it comes off the list.
    updated = await read(await act(added.id!, { action: 'restore' }));
    assert.ok(!updated.structuredResume.skills.some((group) => group.skills.includes('Snowflake')));
    // The facts never move.
    assert.equal(updated.structuredResume.work[0]!.company, 'Globex');

    for (const body of [{ action: 'delete' }, { action: 'edit' }, { action: 'edit', text: ' ' }, { action: 'edit', text: 'x'.repeat(1_001) }]) {
      assert.equal((await act(reworded!.id!, body)).status, 400, JSON.stringify(body).slice(0, 40));
    }
    assert.equal((await act('c99', { action: 'keep' })).status, 404);
    assert.equal((await act(reworded!.id!, { action: 'keep' }, 'someone-else')).status, 404);

    // Downloaded (approved): the version is final.
    assert.equal((await send('POST', `/api/resume-versions/${version.id}/approve`, {})).status, 200);
    const late = await act(reworded!.id!, { action: 'restore' });
    assert.equal(late.status, 409);
    assert.equal(((await late.json()) as { code: string }).code, 'VERSION_FINAL');
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

test('a résumé whose lines are all too long to send gets its own 409', async () => {
  await withStudio(answerWith({}), async ({ agent, send }) => {
    const job = await setUp({ ...TAILOR_BASE, basics: { ...TAILOR_BASE.basics, summary: 'x '.repeat(2_000) }, work: [] });
    const response = await send('POST', `/api/jobs/${job.id}/tailor`, {});
    assert.equal(response.status, 409);
    const body = (await response.json()) as { code: string; error: string };
    assert.equal(body.code, 'RESUME_LINES_TOO_LONG');
    assert.match(body.error, /too long/);
    assert.equal(agent.calls.length, 0);
  });
});

// Step 4 review fixes.
test('a line of an older draft, saved before lines knew where they moved, is not changed blindly', async () => {
  const answer = answerWith({
    edits: [edit('work[0].highlights[1]', 'Cut p95 latency 40% with Redis caching')],
    highlight_orders: [{ work_index: 0, highlight_order: [1, 0, 2, 3, 4] }],
  });
  await withStudio(answer, async ({ send }) => {
    const job = await setUp();
    const version = await tailor(send, job.id);
    // A step-3 draft: the same details, without targetPath.
    const old = {
      ...version,
      id: randomUUID(),
      changeDetails: version.changeDetails!.map((detail) => {
        const copy = { ...detail };
        delete copy.targetPath;
        return copy;
      }),
    } as ResumeVersionRecord;
    await insertResumeVersion(old);
    const response = await send('PATCH', `/api/resume-versions/${old.id}/changes/c0`, { action: 'restore' });
    assert.equal(response.status, 409);
    assert.equal(((await response.json()) as { code: string }).code, 'TAILOR_AGAIN');
  });
});

test('the review only offers what can apply, and coverage follows the review', async () => {
  const answer = answerWith({
    // 9,000 merchants is a number the base résumé doesn't have: dropped.
    edits: [edit('work[0].highlights[0]', 'Built the billing API in Go serving 9,000 merchants')],
  });
  await withStudio(answer, async ({ send }) => {
    const job = await setUp();
    await saveJobAnalysis('user-studio', job.id, sampleAnalysis(), 70);
    const version = await tailor(send, job.id, { confirmedKeywords: ['Kafka'] });
    const dropped = version.changeDetails!.find((d) => d.kind === 'rewrite')!;
    assert.equal(dropped.dropped, true);
    const added = version.changeDetails!.find((d) => d.kind === 'skill-added')!;
    assert.equal((await send('PATCH', `/api/resume-versions/${version.id}/changes/${dropped.id}`, { action: 'keep' })).status, 400);
    assert.deepEqual(version.basedOn!.coverage, { total: 3, before: 2, after: 3, terms: ['Go', 'Postgres', 'Kafka'] });
    const removed = (await (await send('PATCH', `/api/resume-versions/${version.id}/changes/${added.id}`, { action: 'restore' })).json()) as {
      version: ResumeVersionRecord;
    };
    assert.deepEqual(removed.version.basedOn!.coverage, { total: 3, before: 2, after: 2, terms: ['Go', 'Postgres', 'Kafka'] });
  });
});

test('the window offers skills with digits and short names, not requirement sentences', async () => {
  await withStudio(answerWith({}), async ({ send }) => {
    const base = { ...TAILOR_BASE, skills: [...TAILOR_BASE.skills, { category: 'Other', skills: ['UX', 'S3'] }] };
    const job = await setUp(base);
    await saveJobAnalysis(
      'user-studio',
      job.id,
      sampleAnalysis({
        requiredSkills: ['S3', 'HTML5', 'UX', 'OAuth 2.0'],
        preferredSkills: ['Excellent written communication skills', "Bachelor's degree in CS", '5+ years of Go'],
        atsKeywords: [],
        missingSkills: [],
      }),
      70,
    );
    const { keywords } = (await (await send('GET', `/api/jobs/${job.id}/tailor/keywords`)).json()) as {
      keywords: Array<{ term: string; onResume: boolean }>;
    };
    assert.deepEqual(keywords, [
      { term: 'S3', onResume: true },
      { term: 'HTML5', onResume: false },
      { term: 'UX', onResume: true },
      { term: 'OAuth 2.0', onResume: false },
    ]);
  });
});

test('adding keywords to the base résumé keeps a change saved during the run', async () => {
  const answer = answerWith({ edits: [edit('work[0].highlights[2]', 'Mentored 2 interns')] });
  await withStudio(
    answer,
    async ({ send }) => {
      const job = await setUp();
      const response = await send('POST', `/api/jobs/${job.id}/tailor`, { confirmedKeywords: ['Kafka'], addToBase: true });
      assert.equal(response.status, 201);
      const base = (await getUserProfile('user-studio'))!.baseResume!;
      assert.equal(base.basics.summary, 'Edited in Settings during the run.');
      assert.deepEqual(base.skills.at(-1), { category: 'Other', skills: ['Kafka'] });
    },
    {
      // A Settings save while the AI is working.
      duringAgent: async () => {
        const base = (await getUserProfile('user-studio'))!.baseResume!;
        await upsertUserProfile('user-studio', {
          baseResume: { ...base, basics: { ...base.basics, summary: 'Edited in Settings during the run.' } },
        });
      },
    },
  );
});

test('two runs that add keywords to the base résumé at once keep both', async () => {
  const answer = answerWith({ edits: [edit('work[0].highlights[2]', 'Mentored 2 interns')] });
  let arrived = 0;
  let release: () => void = () => undefined;
  const bothArrived = new Promise<void>((resolve) => (release = resolve));
  await withStudio(
    answer,
    async ({ send }) => {
      const first = await setUp();
      const second = await createJob('user-studio', { company: 'Globex', title: 'Backend Engineer', descriptionText: POSTING });
      const responses = await Promise.all([
        send('POST', `/api/jobs/${first.id}/tailor`, { confirmedKeywords: ['Kafka'], addToBase: true }),
        send('POST', `/api/jobs/${second.id}/tailor`, { confirmedKeywords: ['Snowflake'], addToBase: true }),
      ]);
      assert.deepEqual(responses.map((r) => r.status), [201, 201]);
      const other = (await getUserProfile('user-studio'))!.baseResume!.skills.find((g) => g.category === 'Other');
      assert.deepEqual([...other!.skills].sort(), ['Kafka', 'Snowflake']);
    },
    {
      // Both runs are in flight before either answers.
      duringAgent: async () => {
        arrived += 1;
        if (arrived === 2) release();
        await bothArrived;
      },
    },
  );
});

test("a dropped suggestion can't be put back by editing it in unchanged", async () => {
  const answer = answerWith({ edits: [edit('work[0].highlights[0]', 'Built the billing API in Go serving 9,000 merchants')] });
  await withStudio(answer, async ({ send }) => {
    const job = await setUp();
    const version = await tailor(send, job.id);
    const dropped = version.changeDetails!.find((d) => d.kind === 'rewrite')!;
    assert.equal(dropped.dropped, true);
    const path = `/api/resume-versions/${version.id}/changes/${dropped.id}`;
    assert.equal((await send('PATCH', path, { action: 'edit', text: dropped.newText })).status, 400);
    assert.equal((await send('PATCH', path, { action: 'edit', text: '  built the billing API in Go  serving 9,000 merchants ' })).status, 400);
    assert.equal((await send('PATCH', path, { action: 'edit', text: 'Built the billing API in Go for 2,000 merchants' })).status, 200);
  });
});

test('coverage keeps counting the keywords it started with after a new fit read', async () => {
  const answer = answerWith({ edits: [edit('work[0].highlights[2]', 'Mentored 2 interns')] });
  await withStudio(answer, async ({ send }) => {
    const job = await setUp();
    await saveJobAnalysis('user-studio', job.id, sampleAnalysis(), 70);
    const version = await tailor(send, job.id, { confirmedKeywords: ['Kafka'] });
    // Another fit read, with as many keywords but different ones.
    await saveJobAnalysis(
      'user-studio',
      job.id,
      sampleAnalysis({ requiredSkills: ['Rust', 'Elixir'], preferredSkills: ['Scala'], atsKeywords: [], missingSkills: [] }),
      70,
    );
    const added = version.changeDetails!.find((d) => d.kind === 'skill-added')!;
    const removed = (await (await send('PATCH', `/api/resume-versions/${version.id}/changes/${added.id}`, { action: 'restore' })).json()) as {
      version: ResumeVersionRecord;
    };
    assert.deepEqual(removed.version.basedOn!.coverage, { total: 3, before: 2, after: 2, terms: ['Go', 'Postgres', 'Kafka'] });
  });
});
