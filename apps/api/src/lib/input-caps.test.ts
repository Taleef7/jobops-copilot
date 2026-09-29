import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { capAgentPayload, LLM_JOB_TEXT_MAX, LLM_PROFILE_TEXT_MAX } from './input-caps';

test('capAgentPayload truncates known text fields and reports it', () => {
  const long = 'x'.repeat(50_000);
  const { payload, truncated } = capAgentPayload({
    description_text: long,
    resume_text: long,
    profile_text: 'short',
    required_skills: ['Go'],
    input: { job_description: long, note: long },
  });
  const capped = payload as Record<string, unknown> & { input: Record<string, string> };
  assert.equal(truncated, true);
  assert.equal((capped.description_text as string).length, LLM_JOB_TEXT_MAX);
  assert.equal((capped.resume_text as string).length, LLM_PROFILE_TEXT_MAX);
  assert.equal(capped.profile_text, 'short');
  assert.deepEqual(capped.required_skills, ['Go']);
  // One level down too (the specialist agents take an `input` object); unknown fields untouched.
  assert.equal(capped.input.job_description?.length, LLM_JOB_TEXT_MAX);
  assert.equal(capped.input.note?.length, 50_000);
});

test('capAgentPayload leaves short payloads and non-objects alone', () => {
  const small = { description_text: 'A job', resume_text: 'Me' };
  assert.deepEqual(capAgentPayload(small), { payload: small, truncated: false });
  assert.deepEqual(capAgentPayload(null), { payload: null, truncated: false });
  assert.deepEqual(capAgentPayload([1, 2]), { payload: [1, 2], truncated: false });
});

test('the agent receives at most the capped length, whatever was stored (#345)', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const server = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      bodies.push(JSON.parse(raw) as Record<string, unknown>);
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  const saved = process.env.AGENT_SERVICE_URL;
  process.env.AGENT_SERVICE_URL = `http://127.0.0.1:${address.port}`;
  try {
    const { resolveParsedJob, resolveFitScore } = await import('./agent-client');
    const posting = 'Build APIs. '.repeat(90_000); // over 1 MB
    await resolveParsedJob(posting);
    await resolveFitScore({ descriptionText: posting, resumeText: 'r'.repeat(60_000), profileText: 'p' });
    assert.equal((bodies[0]!.description_text as string).length, LLM_JOB_TEXT_MAX);
    assert.equal((bodies[1]!.description_text as string).length, LLM_JOB_TEXT_MAX);
    assert.equal((bodies[1]!.resume_text as string).length, LLM_PROFILE_TEXT_MAX);
  } finally {
    if (saved === undefined) delete process.env.AGENT_SERVICE_URL;
    else process.env.AGENT_SERVICE_URL = saved;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('the research agent job description (sent as `context`) is capped too', () => {
  const { payload, truncated } = capAgentPayload({ company: 'Acme', context: 'x'.repeat(100_000) });
  assert.equal(truncated, true);
  assert.equal(((payload as Record<string, string>).context ?? '').length, LLM_JOB_TEXT_MAX);
});

test('specialist inputs are capped however they nest (input.job.description_text, arrays)', () => {
  const long = 'x'.repeat(100_000);
  const { payload, truncated } = capAgentPayload({
    input: { job: { description_text: long }, jobs: [{ description_text: long }, { resume_text: long }] },
  });
  const input = (payload as { input: { job: { description_text: string }; jobs: Array<Record<string, string>> } }).input;
  assert.equal(truncated, true);
  assert.equal(input.job.description_text.length, LLM_JOB_TEXT_MAX);
  assert.equal(input.jobs[0]!.description_text!.length, LLM_JOB_TEXT_MAX);
  assert.equal(input.jobs[1]!.resume_text!.length, LLM_PROFILE_TEXT_MAX);
});
