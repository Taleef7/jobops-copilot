import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { appendOutreachDraft, createJob, getJobById, resetJobStoreForTests } from '@/data/job-store';
import { resetCoverLetterStoreForTests } from '@/data/cover-letter-store';
import { resetResumeVersionStore } from '@/data/resume-version-store';
import { upsertUserProfile } from '@/data/profile-store';
import { apiErrorHandler } from '@/lib/api-error-handler';
import { MAX_GENERATED_WORDS } from '@/lib/cover-letter/limits';
import type { CoverLetterAgentRequest } from '@/lib/cover-letter/answer';
import { TAILOR_BASE } from '@/test-support/tailor-fixtures';
import { flat, readPdf } from '@/test-support/pdf-read';
import type { CoverLetterRecord, StructuredResume } from '@/types';
import { coverLetterRouter } from './cover-letter';

/**
 * The cover letter in the tailor window (#416): the AI writes a Concise or Full letter, the API
 * drops any sentence its check can't ground in the base résumé or the posting, and saves one
 * letter per job. Each paragraph can be edited; the PDF is always one page. A fake agent
 * answers like the real one.
 */

const POSTING = 'Acme Pay is hiring a backend engineer to build payment APIs in Go. Kafka is a plus.';
const USER = 'user-letter';

type Send = (method: string, path: string, body?: unknown, user?: string) => Promise<Response>;

interface Agent {
  calls: Array<{ path: string; body: CoverLetterAgentRequest }>;
  answer: unknown;
}

async function withLetters(
  answer: unknown,
  run: (ctx: { agent: Agent; send: Send }) => Promise<void>,
  options: { agentDown?: boolean; status?: number } = {},
) {
  const originalCwd = process.cwd();
  const originalAgent = process.env.AGENT_SERVICE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-letter-'));
  delete process.env.DATABASE_URL;
  process.chdir(tempDir);
  await resetJobStoreForTests();
  await resetResumeVersionStore();
  await resetCoverLetterStoreForTests();

  const agent: Agent = { calls: [], answer };
  const agentServer = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      agent.calls.push({ path: request.url ?? '', body: JSON.parse(raw || '{}') as CoverLetterAgentRequest });
      response.writeHead(options.status ?? 200, { 'Content-Type': 'application/json' }).end(JSON.stringify(agent.answer));
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
  app.use('/api', coverLetterRouter);
  app.use(apiErrorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  const send: Send = (method, path, body, user = USER) =>
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
    await resetCoverLetterStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
}

const answerOf = (paragraphs: string[]) => ({ paragraphs, model_used: 'openai:gpt-6-luna', refused: false });

/** Sentences every word of which the base résumé or the posting supports. */
const GROUNDED = [
  'I am applying for the Backend Engineer role at Acme Pay.',
  'I am a backend engineer who builds payment APIs in Go.',
  'At Globex I built the billing API in Go serving 2,000 merchants.',
  'I reduced p95 latency by 40% with Redis caching.',
  'I mentored two interns and partnered with sales on the go-to-market launch.',
  'At Initech I automated nightly reports with Python, saving 10 hours a week.',
  'I migrated 3 services to EC2 and S3.',
  'I hold a BSc in Computer Science from the University of London.',
  'My skills include Go, Python, SQL, PostgreSQL and Docker.',
  'I would welcome the chance to talk about this work with Acme Pay.',
];

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** A letter of about `target` words in `count` paragraphs, from the grounded sentences. */
function letterOf(target: number, count: number): string[] {
  const sentences: string[] = [];
  for (let i = 0; words(sentences.join(' ')) < target; i += 1) sentences.push(GROUNDED[i % GROUNDED.length]!);
  const per = Math.ceil(sentences.length / count);
  return Array.from({ length: count }, (_, p) => sentences.slice(p * per, (p + 1) * per).join(' ')).filter(Boolean);
}

async function setUp(resume: StructuredResume | null = TAILOR_BASE, descriptionText = POSTING, user = USER) {
  const job = await createJob(user, { company: 'Acme Pay Inc.', title: 'Backend Engineer', descriptionText });
  if (resume) await upsertUserProfile(user, { baseResume: resume });
  return job;
}

async function write(send: Send, jobId: string, body: unknown = { length: 'concise' }): Promise<CoverLetterRecord> {
  const response = await send('POST', `/api/jobs/${jobId}/cover-letter`, body);
  const payload = (await response.json()) as { coverLetter: CoverLetterRecord; error?: string };
  assert.equal(response.status, 201, JSON.stringify(payload));
  return payload.coverLetter;
}

async function read(send: Send, jobId: string, user = USER): Promise<CoverLetterRecord | null> {
  const response = await send('GET', `/api/jobs/${jobId}/cover-letter`, undefined, user);
  assert.equal(response.status, 200);
  return ((await response.json()) as { coverLetter: CoverLetterRecord | null }).coverLetter;
}

async function download(send: Send, jobId: string, query = '') {
  const response = await send('GET', `/api/jobs/${jobId}/cover-letter/download${query}`);
  assert.equal(response.status, 200, await response.clone().text());
  const pdf = await readPdf(new Uint8Array(await response.arrayBuffer()));
  return { response, pdf, text: flat(pdf.text) };
}

test('writes a Concise letter from the base résumé and the posting, and records what it was based on', async () => {
  const paragraphs = letterOf(180, 3);
  await withLetters(answerOf(paragraphs), async ({ agent, send }) => {
    const job = await setUp();
    const letter = await write(send, job.id, { length: 'concise' });

    assert.equal(agent.calls.length, 1);
    const sent = agent.calls[0]!;
    assert.equal(sent.path, '/cover-letter');
    assert.equal(sent.body.length, 'concise');
    assert.equal(sent.body.job_title, 'Backend Engineer');
    assert.equal(sent.body.company, 'Acme Pay Inc.');
    assert.equal(sent.body.description_text, POSTING);
    assert.match(sent.body.facts, /work\[0\]: Backend Engineer, Globex/);
    assert.doesNotMatch(sent.body.facts, /jordan@example\.com/, 'contact details are not sent');
    assert.ok(sent.body.lines.includes('Built the billing API in Go serving 2,000 merchants'));
    assert.deepEqual(sent.body.skills, ['Go', 'Python', 'SQL', 'PostgreSQL', 'Docker']);
    assert.deepEqual(sent.body.confirmed_keywords, []);

    assert.equal(letter.jobId, job.id);
    assert.equal(letter.length, 'concise');
    assert.deepEqual(
      letter.paragraphs.map((p) => p.text),
      paragraphs,
    );
    assert.ok(letter.paragraphs.every((p) => p.edited === false));
    assert.deepEqual(letter.checks, []);
    assert.equal(letter.basedOn.model, 'openai:gpt-6-luna');
    assert.equal(letter.basedOn.jobId, job.id);
    assert.equal(letter.basedOn.postingSha256, createHash('sha256').update(POSTING).digest('hex'));
    assert.deepEqual(letter.basedOn.confirmedKeywords, []);

    assert.deepEqual(await read(send, job.id), letter);
  });
});

test('a sentence that invents a metric or a skill is dropped, shown with its reason, and kept out of the PDF', async () => {
  const metric = 'At Globex I cut p95 latency by 60% with Redis caching.';
  const skill = 'I have run Kafka clusters in production.';
  const opening = letterOf(80, 1)[0]!;
  const paragraphs = [
    opening,
    `At Globex I built the billing API in Go serving 2,000 merchants. ${metric}`,
    `${skill} I would welcome the chance to talk about this work with Acme Pay.`,
  ];
  await withLetters(answerOf(paragraphs), async ({ send }) => {
    const job = await setUp();
    const letter = await write(send, job.id);
    assert.deepEqual(
      letter.paragraphs.map((p) => p.text),
      [opening, 'At Globex I built the billing API in Go serving 2,000 merchants.', 'I would welcome the chance to talk about this work with Acme Pay.'],
    );
    const dropped = letter.checks.filter((c) => c.dropped);
    assert.deepEqual(
      dropped.map((c) => c.text),
      [metric, skill],
    );
    assert.match(dropped[0]!.dropReason!, /60%/);
    assert.match(dropped[1]!.dropReason!, /Kafka/);

    const { text } = await download(send, job.id);
    assert.doesNotMatch(text, /60%|Kafka/);
    assert.ok(text.includes('serving 2,000 merchants.'), text);
  });
});

test('a keyword confirmed in the tailor window is sent, may be used, and is marked as theirs', async () => {
  const paragraphs = ['I have worked with Kafka alongside Go.', ...letterOf(320, 3)];
  await withLetters(answerOf(paragraphs), async ({ agent, send }) => {
    const job = await setUp();
    const letter = await write(send, job.id, { length: 'full', confirmedKeywords: ['Kafka'] });
    assert.deepEqual(agent.calls[0]!.body.confirmed_keywords, ['Kafka']);
    assert.equal(agent.calls[0]!.body.length, 'full');
    assert.equal(letter.length, 'full');
    assert.equal(letter.paragraphs[0]!.text, 'I have worked with Kafka alongside Go.');
    assert.deepEqual(letter.checks[0]!.confirmedTerms, ['Kafka']);
    assert.deepEqual(letter.basedOn.confirmedKeywords, ['Kafka']);
  });
});

test('when the AI is down, unusable, writes nothing that passes, or writes too much: 503 and no letter is written', async () => {
  const tooLong = letterOf(MAX_GENERATED_WORDS.concise + 40, 3);
  const cases: Array<[string, unknown, boolean]> = [
    ['down', {}, true],
    ['not a letter', { paragraphs: 'none', model_used: 'x' }, false],
    ['no model', { paragraphs: ['I build payment APIs in Go.'] }, false],
    ['nothing passes the check', answerOf(['I have run Kafka clusters in production.']), false],
    [
      'most of it is dropped by the check',
      answerOf([letterOf(40, 1)[0]!, Array.from({ length: 12 }, () => 'I have run Kafka clusters in production.').join(' ')]),
      false,
    ],
    ['empty', answerOf([]), false],
    ['too long for a concise letter', answerOf(tooLong), false],
  ];
  for (const [label, answer, agentDown] of cases) {
    await withLetters(
      answer,
      async ({ send }) => {
        const job = await setUp();
        const response = await send('POST', `/api/jobs/${job.id}/cover-letter`, { length: 'concise' });
        const body = (await response.json()) as { retryable?: boolean; error?: string };
        assert.equal(response.status, 503, `${label}: ${JSON.stringify(body)}`);
        assert.equal(body.retryable, true, label);
        assert.ok(body.error, label);
        assert.equal(await read(send, job.id), null, `${label}: nothing written`);
      },
      { agentDown },
    );
  }
});

test('a failed rewrite leaves the letter there is', async () => {
  await withLetters(answerOf(letterOf(180, 3)), async ({ agent, send }) => {
    const job = await setUp();
    const first = await write(send, job.id);
    agent.answer = {};
    const response = await send('POST', `/api/jobs/${job.id}/cover-letter`, { length: 'full' });
    assert.equal(response.status, 503);
    assert.deepEqual(await read(send, job.id), first);
  });
});

test('a posting the agent refuses as a prompt injection: 422, and nothing is written', async () => {
  await withLetters({ paragraphs: [], model_used: 'openai:gpt-6-luna', refused: true }, async ({ send }) => {
    const job = await setUp();
    const response = await send('POST', `/api/jobs/${job.id}/cover-letter`, { length: 'concise' });
    assert.equal(response.status, 422);
    assert.equal(((await response.json()) as { code?: string }).code, 'POSTING_REFUSED');
    assert.equal(await read(send, job.id), null);
  });
});

test('nothing to write from: 409 without calling the AI; a bad request: 400', async () => {
  await withLetters(answerOf(letterOf(180, 3)), async ({ agent, send }) => {
    const empty = await setUp({ ...TAILOR_BASE, basics: { ...TAILOR_BASE.basics, summary: '' }, work: [] }, POSTING, 'user-empty');
    const noResume = await send('POST', `/api/jobs/${empty.id}/cover-letter`, { length: 'concise' }, 'user-empty');
    assert.equal(noResume.status, 409);
    assert.equal(((await noResume.json()) as { code?: string }).code, 'BASE_RESUME_EMPTY');

    const blank = await setUp(TAILOR_BASE, '   ');
    const noPosting = await send('POST', `/api/jobs/${blank.id}/cover-letter`, { length: 'concise' });
    assert.equal(noPosting.status, 409);
    assert.equal(((await noPosting.json()) as { code?: string }).code, 'POSTING_EMPTY');

    const job = await setUp();
    for (const body of [{}, { length: 'long' }, { length: 'full', confirmedKeywords: 'Kafka' }, { length: 'full', confirmedKeywords: ['x'.repeat(61)] }]) {
      const response = await send('POST', `/api/jobs/${job.id}/cover-letter`, body);
      assert.equal(response.status, 400, JSON.stringify(body));
    }
    assert.equal((await send('POST', `/api/jobs/${randomUUID()}/cover-letter`, { length: 'full' })).status, 404);
    assert.equal(agent.calls.length, 0);
  });
});

test('an edited paragraph persists, is marked as the user’s, and the PDF shows it', async () => {
  await withLetters(answerOf(letterOf(180, 3)), async ({ send }) => {
    const job = await setUp();
    const letter = await write(send, job.id);
    const mine = 'I have spent the last few years building payment APIs, and I would like to keep doing it at Acme Pay.';
    const response = await send('PATCH', `/api/jobs/${job.id}/cover-letter/paragraphs/1`, { text: `  ${mine}\n`, updatedAt: letter.updatedAt });
    assert.equal(response.status, 200, await response.clone().text());
    const edited = ((await response.json()) as { coverLetter: CoverLetterRecord }).coverLetter;
    assert.deepEqual(edited.paragraphs[1], { text: mine, edited: true });
    assert.equal(edited.paragraphs[0]!.edited, false);
    assert.deepEqual(await read(send, job.id), edited);

    const { text } = await download(send, job.id);
    assert.ok(text.includes(mine), text);
    assert.ok(!text.includes(letter.paragraphs[1]!.text), 'the old paragraph is gone');

    // A stale edit (another tab), a paragraph that isn't there, and text that isn't a paragraph.
    const stale = await send('PATCH', `/api/jobs/${job.id}/cover-letter/paragraphs/0`, { text: 'Hello there.', updatedAt: letter.updatedAt });
    assert.equal(stale.status, 409);
    assert.equal(((await stale.json()) as { code?: string }).code, 'LETTER_CHANGED');
    assert.equal((await send('PATCH', `/api/jobs/${job.id}/cover-letter/paragraphs/9`, { text: 'Hello there.' })).status, 404);
    for (const text of ['', '   ', 42, 'x'.repeat(1_501), 'bad\u0000text']) {
      assert.equal((await send('PATCH', `/api/jobs/${job.id}/cover-letter/paragraphs/0`, { text })).status, 400, JSON.stringify(text));
    }
  });
});

test('an edit that would push the letter past one page is refused', async () => {
  await withLetters(answerOf(letterOf(180, 3)), async ({ send }) => {
    const job = await setUp();
    await write(send, job.id);
    const long = Array.from({ length: 175 }, () => 'payment').join(' ');
    // Each paragraph is within its own limit; together they are over the letter's.
    for (const index of [0, 1]) {
      const response = await send('PATCH', `/api/jobs/${job.id}/cover-letter/paragraphs/${index}`, { text: long });
      assert.equal(response.status, 200, await response.text());
    }
    const response = await send('PATCH', `/api/jobs/${job.id}/cover-letter/paragraphs/2`, { text: long });
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as { code?: string }).code, 'LETTER_TOO_LONG');
  });
});

test('Concise and Full each download as exactly one page, named “First Last – Company – Cover letter.pdf”', async () => {
  for (const [length, target, count] of [
    ['concise', 190, 3],
    ['full', 400, 4],
  ] as const) {
    const paragraphs = letterOf(target, count);
    await withLetters(answerOf(paragraphs), async ({ send }) => {
      const job = await setUp();
      await write(send, job.id, { length });
      const { response, pdf, text } = await download(send, job.id, '?date=2026-10-15');
      assert.equal(response.headers.get('content-type'), 'application/pdf');
      assert.equal(response.headers.get('x-page-count'), '1', length);
      assert.equal(pdf.pages.length, 1, length);
      // "Jordan Lee – Acme Pay – Cover letter.pdf" in UTF-8, with a plain ASCII name for old clients.
      const disposition = response.headers.get('content-disposition') ?? '';
      assert.ok(disposition.startsWith('attachment; filename="Jordan Lee - Acme Pay - Cover letter.pdf"; '), disposition);
      assert.ok(
        disposition.endsWith(`filename*=UTF-8''Jordan%20Lee%20%E2%80%93%20Acme%20Pay%20%E2%80%93%20Cover%20letter.pdf`),
        disposition,
      );
      for (const part of ['Jordan Lee', 'jordan@example.com', 'October 15, 2026', 'Acme Pay Inc.', 'Re: Backend Engineer', 'Dear Acme Pay hiring team,', 'Sincerely, Jordan Lee']) {
        assert.ok(text.includes(part), `${length}: ${part}`);
      }
      for (const paragraph of paragraphs) assert.ok(text.includes(paragraph), `${length}: ${paragraph.slice(0, 40)}`);
    });
  }
});

test('one letter per job: writing again replaces it, and an outreach draft for the job leaves it alone', async () => {
  await withLetters(answerOf(letterOf(180, 3)), async ({ agent, send }) => {
    const job = await setUp();
    const first = await write(send, job.id);
    for (let i = 0; i < 2; i += 1) {
      await appendOutreachDraft(USER, job.id, {
        id: randomUUID(),
        jobId: job.id,
        messageType: 'recruiter_email',
        draftText: `Hello ${i}`,
        status: 'drafted',
        createdAt: new Date().toISOString(),
      });
    }
    assert.equal((await getJobById(USER, job.id))!.outreach.length, 1, 'the second draft replaced the first');
    assert.deepEqual(await read(send, job.id), first, 'the cover letter is untouched');

    agent.answer = answerOf(letterOf(400, 4));
    const second = await write(send, job.id, { length: 'full' });
    assert.equal(second.length, 'full');
    const current = await read(send, job.id);
    assert.deepEqual(current, second);
    assert.notDeepEqual(current!.paragraphs, first.paragraphs);
  });
});

test("another user can't read, edit or download a letter", async () => {
  await withLetters(answerOf(letterOf(180, 3)), async ({ send }) => {
    const job = await setUp();
    await write(send, job.id);
    assert.equal((await send('GET', `/api/jobs/${job.id}/cover-letter`, undefined, 'intruder')).status, 404);
    assert.equal((await send('PATCH', `/api/jobs/${job.id}/cover-letter/paragraphs/0`, { text: 'Mine now.' }, 'intruder')).status, 404);
    assert.equal((await send('GET', `/api/jobs/${job.id}/cover-letter/download`, undefined, 'intruder')).status, 404);
    assert.equal((await send('POST', `/api/jobs/${job.id}/cover-letter`, { length: 'full' }, 'intruder')).status, 404);
  });
});

test('a job without a letter: GET is null, edit and download are 404', async () => {
  await withLetters(answerOf([]), async ({ send }) => {
    const job = await setUp();
    assert.equal(await read(send, job.id), null);
    assert.equal((await send('PATCH', `/api/jobs/${job.id}/cover-letter/paragraphs/0`, { text: 'Hello.' })).status, 404);
    assert.equal((await send('GET', `/api/jobs/${job.id}/cover-letter/download`)).status, 404);
  });
});

test('a paragraph can be removed, but not the last one', async () => {
  const paragraphs = ['I have worked with Kafka alongside Go.', ...letterOf(240, 3)];
  await withLetters(answerOf(paragraphs), async ({ send }) => {
    const job = await setUp();
    const letter = await write(send, job.id, { length: 'concise', confirmedKeywords: ['Kafka'] });
    assert.equal(letter.paragraphs.length, 4);
    assert.equal(letter.checks[0]!.paragraph, 0);

    const stale = await send('DELETE', `/api/jobs/${job.id}/cover-letter/paragraphs/0?updatedAt=2020-01-01T00:00:00.000Z`);
    assert.equal(stale.status, 409);
    assert.equal((await send('DELETE', `/api/jobs/${job.id}/cover-letter/paragraphs/7`)).status, 404);
    assert.equal((await send('DELETE', `/api/jobs/${job.id}/cover-letter/paragraphs/0?updatedAt=yesterday`)).status, 400);
    assert.equal((await send('PATCH', `/api/jobs/${job.id}/cover-letter/paragraphs/0`, { text: 'Hello.', updatedAt: 'yesterday' })).status, 400);

    const response = await send('DELETE', `/api/jobs/${job.id}/cover-letter/paragraphs/0?updatedAt=${encodeURIComponent(letter.updatedAt)}`);
    assert.equal(response.status, 200, await response.clone().text());
    const removed = ((await response.json()) as { coverLetter: CoverLetterRecord }).coverLetter;
    assert.deepEqual(
      removed.paragraphs.map((p) => p.text),
      letter.paragraphs.slice(1).map((p) => p.text),
    );
    // The removed paragraph's marks go with it.
    assert.ok(removed.checks.every((check) => check.paragraph !== 0 || check.dropped), JSON.stringify(removed.checks));
    assert.deepEqual(await read(send, job.id), removed);

    for (let left = removed.paragraphs.length; left > 1; left -= 1) {
      assert.equal((await send('DELETE', `/api/jobs/${job.id}/cover-letter/paragraphs/0`)).status, 200);
    }
    const last = await send('DELETE', `/api/jobs/${job.id}/cover-letter/paragraphs/0`);
    assert.equal(last.status, 400);
    assert.equal((await read(send, job.id))!.paragraphs.length, 1);
    const { text } = await download(send, job.id);
    assert.ok(text.includes(letter.paragraphs[3]!.text));
  });
});

test('an edit or a removal names the paragraph it means: a paragraph that changed meanwhile is a 409', async () => {
  await withLetters(answerOf(letterOf(240, 3)), async ({ send }) => {
    const job = await setUp();
    const letter = await write(send, job.id);
    const [first, second] = letter.paragraphs.map((p) => p.text);
    // The page meant the second paragraph, but another tab removed the first: index 1 is now another one.
    const moved = await send('PATCH', `/api/jobs/${job.id}/cover-letter/paragraphs/0`, { text: 'Mine.', expectedText: second });
    assert.equal(moved.status, 409);
    assert.equal(((await moved.json()) as { code?: string }).code, 'PARAGRAPH_CHANGED');
    const gone = await send('DELETE', `/api/jobs/${job.id}/cover-letter/paragraphs/0`, { expectedText: second });
    assert.equal(gone.status, 409);
    assert.deepEqual((await read(send, job.id))!.paragraphs, letter.paragraphs, 'nothing changed');

    const edited = await send('PATCH', `/api/jobs/${job.id}/cover-letter/paragraphs/0`, { text: 'Mine.', expectedText: first });
    assert.equal(edited.status, 200);
    const removed = await send('DELETE', `/api/jobs/${job.id}/cover-letter/paragraphs/1`, { expectedText: second });
    assert.equal(removed.status, 200);
    assert.equal((await send('DELETE', `/api/jobs/${job.id}/cover-letter/paragraphs/0`, undefined, 'intruder')).status, 404);
    assert.equal((await read(send, job.id))!.paragraphs.length, 2);
  });
});

test('text within the length limits that still needs two pages (wide capitals) is refused by the page check', async () => {
  await withLetters(answerOf(letterOf(180, 3)), async ({ send }) => {
    const job = await setUp();
    await write(send, job.id);
    const shout = 'WWWWWWWWWWWW MMMMMMMMMMMM WORKFLOW MAINTAINED WORLDWIDE. ';
    const paragraph = shout.repeat(40).slice(0, 1_190).trim();
    const statuses: Array<{ status: number; code?: string; error?: string }> = [];
    for (const index of [0, 1, 2]) {
      const response = await send('PATCH', `/api/jobs/${job.id}/cover-letter/paragraphs/${index}`, { text: paragraph });
      statuses.push({ status: response.status, ...((await response.json()) as { code?: string; error?: string }) });
    }
    const refused = statuses.find((s) => s.status === 400);
    assert.ok(refused, JSON.stringify(statuses.map((s) => s.status)));
    assert.equal(refused.code, 'LETTER_TOO_LONG');
    assert.doesNotMatch(refused.error ?? '', /520 words/, 'within the word and character limits: refused for its pages');
    const { pdf } = await download(send, job.id);
    assert.equal(pdf.pages.length, 1);
  });
});

test('an answer far longer than any letter is refused before the check: 503 at once, nothing written', async () => {
  for (const paragraphs of [['a.'.repeat(50_000)], Array.from({ length: 8 }, () => 'I build payment APIs in Go. '.repeat(60))]) {
    await withLetters(answerOf(paragraphs), async ({ send }) => {
      const job = await setUp();
      const started = performance.now();
      const response = await send('POST', `/api/jobs/${job.id}/cover-letter`, { length: 'full' });
      const ms = performance.now() - started;
      assert.equal(response.status, 503);
      // The guard's own reason: without it the check would read the answer and say something else.
      assert.match(((await response.json()) as { error?: string }).error ?? '', /far longer than a letter/);
      assert.ok(ms < 1_500, `${ms.toFixed(0)} ms`);
      assert.equal(await read(send, job.id), null);
    });
  }
});

test("the agent's 422s: a validation error is a retryable 503, a refused input a 422, and neither writes a letter", async () => {
  const cases: Array<[string, unknown, number]> = [
    ['FastAPI validation', { detail: [{ loc: ['body', 'length'], msg: 'Input should be concise or full', type: 'literal_error' }] }, 503],
    ['refused input', { detail: { code: 'input_refused', message: 'refused' } }, 422],
  ];
  for (const [label, answer, expected] of cases) {
    await withLetters(
      answer,
      async ({ send }) => {
        const job = await setUp();
        const response = await send('POST', `/api/jobs/${job.id}/cover-letter`, { length: 'concise' });
        const body = (await response.json()) as { retryable?: boolean };
        assert.equal(response.status, expected, `${label}: ${JSON.stringify(body)}`);
        if (expected === 503) assert.equal(body.retryable, true, label);
        assert.equal(await read(send, job.id), null, `${label}: nothing written`);
      },
      { status: 422 },
    );
  }
});

// The owner's rule (#416): what the check can only guess is flagged, kept in the letter, and must
// be kept or removed by the user before the letter prints.
const FLAGGED = 'Before Globex, I worked at google on payment APIs.';

async function writeWithFlag(send: Send, jobId: string): Promise<CoverLetterRecord> {
  const letter = await write(send, jobId);
  const flag = letter.checks.find((check) => check.severity === 'flag');
  assert.ok(flag, JSON.stringify(letter.checks));
  assert.equal(flag.text, FLAGGED);
  return letter;
}

const flaggedLetter = () => answerOf([letterOf(120, 1)[0]!, `${FLAGGED} ${GROUNDED[2]}`, GROUNDED[9]!]);

test('a flagged sentence stays in the letter, and the PDF waits until it is kept or removed', async () => {
  await withLetters(flaggedLetter(), async ({ send }) => {
    const job = await setUp();
    const letter = await writeWithFlag(send, job.id);
    assert.ok(letter.paragraphs[1]!.text.includes(FLAGGED));

    const blocked = await send('GET', `/api/jobs/${job.id}/cover-letter/download`);
    assert.equal(blocked.status, 409);
    assert.equal(((await blocked.json()) as { code?: string }).code, 'FLAGS_UNRESOLVED');

    const flag = letter.checks.find((check) => check.severity === 'flag')!;
    const kept = await send('PATCH', `/api/jobs/${job.id}/cover-letter/checks/${flag.id}`, {
      action: 'keep',
      expectedText: letter.paragraphs[1]!.text,
      updatedAt: letter.updatedAt,
    });
    assert.equal(kept.status, 200, await kept.clone().text());
    const after = ((await kept.json()) as { coverLetter: CoverLetterRecord }).coverLetter;
    assert.equal(after.checks.find((check) => check.id === flag.id)!.resolution, 'kept');
    const { text } = await download(send, job.id);
    assert.ok(text.includes(FLAGGED));
  });
});

test('removing a flagged sentence edits its paragraph through the guarded path', async () => {
  await withLetters(flaggedLetter(), async ({ send }) => {
    const job = await setUp();
    const letter = await writeWithFlag(send, job.id);
    const flag = letter.checks.find((check) => check.severity === 'flag')!;

    const stale = await send('PATCH', `/api/jobs/${job.id}/cover-letter/checks/${flag.id}`, {
      action: 'remove',
      expectedText: 'Something else.',
      updatedAt: letter.updatedAt,
    });
    assert.equal(stale.status, 409);
    assert.equal(((await stale.json()) as { code?: string }).code, 'PARAGRAPH_CHANGED');

    const removed = await send('PATCH', `/api/jobs/${job.id}/cover-letter/checks/${flag.id}`, {
      action: 'remove',
      expectedText: letter.paragraphs[1]!.text,
      updatedAt: letter.updatedAt,
    });
    assert.equal(removed.status, 200, await removed.clone().text());
    const after = ((await removed.json()) as { coverLetter: CoverLetterRecord }).coverLetter;
    assert.equal(after.paragraphs[1]!.text, GROUNDED[2]);
    assert.equal(after.paragraphs[1]!.edited, false);
    assert.equal(after.checks.find((check) => check.id === flag.id)!.resolution, 'removed');
    const { text } = await download(send, job.id);
    assert.ok(!text.includes('google'));

    const now = after.updatedAt;
    const answer = { expectedText: after.paragraphs[0]!.text, updatedAt: now };
    assert.equal((await send('PATCH', `/api/jobs/${job.id}/cover-letter/checks/nope`, { action: 'keep', ...answer })).status, 404);
    assert.equal((await send('PATCH', `/api/jobs/${job.id}/cover-letter/checks/${flag.id}`, { action: 'maybe', ...answer })).status, 400);
    assert.equal((await send('PATCH', `/api/jobs/${job.id}/cover-letter/checks/${flag.id}`, { action: 'keep', ...answer }, 'intruder')).status, 404);
  });
});

test('a flagged sentence alone in its paragraph takes the paragraph with it', async () => {
  await withLetters(answerOf([letterOf(120, 1)[0]!, FLAGGED, GROUNDED[9]!]), async ({ send }) => {
    const job = await setUp();
    const letter = await writeWithFlag(send, job.id);
    const flag = letter.checks.find((check) => check.severity === 'flag')!;
    const response = await send('PATCH', `/api/jobs/${job.id}/cover-letter/checks/${flag.id}`, {
      action: 'remove',
      expectedText: FLAGGED,
      updatedAt: letter.updatedAt,
    });
    assert.equal(response.status, 200, await response.clone().text());
    const after = ((await response.json()) as { coverLetter: CoverLetterRecord }).coverLetter;
    assert.deepEqual(
      after.paragraphs.map((p) => p.text),
      [letter.paragraphs[0]!.text, GROUNDED[9]],
    );
  });
});

test("editing a paragraph clears its flags: the user's words are theirs", async () => {
  await withLetters(flaggedLetter(), async ({ send }) => {
    const job = await setUp();
    const letter = await writeWithFlag(send, job.id);
    const response = await send('PATCH', `/api/jobs/${job.id}/cover-letter/paragraphs/1`, {
      text: 'At Globex I built the billing API in Go.',
      expectedText: letter.paragraphs[1]!.text,
    });
    assert.equal(response.status, 200);
    const after = ((await response.json()) as { coverLetter: CoverLetterRecord }).coverLetter;
    assert.equal(after.checks.find((check) => check.severity === 'flag')!.resolution, 'edited');
    assert.equal((await send('GET', `/api/jobs/${job.id}/cover-letter/download`)).status, 200);
  });
});

test('the "less than half a letter" 503 counts only dropped sentences, not flagged ones', async () => {
  // Most of this letter is flagged, none of it dropped: it is saved, flags and all.
  const flagged = Array.from({ length: 10 }, () => FLAGGED).join(' ');
  await withLetters(answerOf([letterOf(30, 1)[0]!, flagged]), async ({ send }) => {
    const job = await setUp();
    const letter = await write(send, job.id);
    assert.ok(letter.checks.filter((check) => check.severity === 'flag').length >= 1);
  });
});

// Fourth review (#416).

test('answering a flag needs the letter as read: updatedAt and expectedText are required, and a stale tab is a 409 first', async () => {
  await withLetters(flaggedLetter(), async ({ agent, send }) => {
    const job = await setUp();
    const letter = await writeWithFlag(send, job.id);
    const flag = letter.checks.find((check) => check.severity === 'flag')!;
    const url = `/api/jobs/${job.id}/cover-letter/checks/${flag.id}`;
    assert.equal((await send('PATCH', url, { action: 'keep', expectedText: letter.paragraphs[1]!.text })).status, 400);
    assert.equal((await send('PATCH', url, { action: 'keep', updatedAt: letter.updatedAt })).status, 400);

    // Written again in another tab: the old checkId is stale, and the stale letter is the reason.
    agent.answer = answerOf(letterOf(180, 3));
    await write(send, job.id);
    for (const id of [flag.id, 'c99']) {
      const response = await send('PATCH', `/api/jobs/${job.id}/cover-letter/checks/${id}`, {
        action: 'keep',
        expectedText: letter.paragraphs[1]!.text,
        updatedAt: letter.updatedAt,
      });
      assert.equal(response.status, 409, id);
      assert.equal(((await response.json()) as { code?: string }).code, 'LETTER_CHANGED', id);
    }
    // With the fresh letter, an id it doesn't have is a 404.
    const fresh = (await read(send, job.id))!;
    const missing = await send('PATCH', `/api/jobs/${job.id}/cover-letter/checks/c99`, {
      action: 'keep',
      expectedText: fresh.paragraphs[0]!.text,
      updatedAt: fresh.updatedAt,
    });
    assert.equal(missing.status, 404);
  });
});

// The flagged sentence is also a substring of the one before it: removing by substring would cut that one.
const TWICE_CLIENT = 'I would never write "Acme Pay was my client." in a letter to you. Acme Pay was my client.';

test('a flagged sentence whose words repeat inside another sentence is removed by its place, not by substring', async () => {
  await withLetters(answerOf([letterOf(120, 1)[0]!, TWICE_CLIENT, GROUNDED[9]!]), async ({ send }) => {
    const job = await setUp();
    const letter = await write(send, job.id);
    const flag = letter.checks.find((check) => check.severity === 'flag')!;
    assert.equal(flag.text, 'Acme Pay was my client.');
    assert.equal(flag.sentence, 1);
    const response = await send('PATCH', `/api/jobs/${job.id}/cover-letter/checks/${flag.id}`, {
      action: 'remove',
      expectedText: letter.paragraphs[1]!.text,
      updatedAt: letter.updatedAt,
    });
    assert.equal(response.status, 200, await response.clone().text());
    const after = ((await response.json()) as { coverLetter: CoverLetterRecord }).coverLetter;
    assert.equal(after.paragraphs[1]!.text, 'I would never write "Acme Pay was my client." in a letter to you.');
  });
});

test('Save with the paragraph unchanged answers nothing: no edit, no new updatedAt, the flags stay open', async () => {
  await withLetters(flaggedLetter(), async ({ send }) => {
    const job = await setUp();
    const letter = await writeWithFlag(send, job.id);
    const response = await send('PATCH', `/api/jobs/${job.id}/cover-letter/paragraphs/1`, {
      text: letter.paragraphs[1]!.text,
      expectedText: letter.paragraphs[1]!.text,
      updatedAt: letter.updatedAt,
    });
    assert.equal(response.status, 200);
    const after = ((await response.json()) as { coverLetter: CoverLetterRecord }).coverLetter;
    assert.deepEqual(after, letter);
    assert.equal((await send('GET', `/api/jobs/${job.id}/cover-letter/download`)).status, 409);
  });
});

test('a letter is written with the second version of the check', async () => {
  await withLetters(answerOf(letterOf(180, 3)), async ({ send }) => {
    const job = await setUp();
    assert.deepEqual((await write(send, job.id)).basedOn.grounding, { version: 2 });
  });
});
