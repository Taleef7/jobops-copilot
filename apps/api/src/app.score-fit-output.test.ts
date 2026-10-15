import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from './app';
import { createJob, resetJobStoreForTests } from '@/data/job-store';
import { upsertUserProfile } from '@/data/profile-store';
import { resetUsageStoreForTests } from '@/data/usage-store';
import { FAKE_FIT_SCORE, fakeAgentAnswer } from '@/test-support/fake-agent';

/**
 * #354: what Score fit answers and what the job page reads are the cleaned analysis, not the
 * model's raw answer: short labels as strings (which the web from before #354 renders), the
 * evidence apart, no guessed salary or sponsorship, and confidence on 0–100.
 */
async function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const USER = 'u_fit_output';

const RAW_SCORE = {
  ...FAKE_FIT_SCORE,
  confidence_score: 0.65,
  sub_signals: { skills_match: 80, title_seniority: 70, salary_fit: 30, sponsorship_likelihood: 60 },
  matched_skills: [
    { skill: 'Go: built the billing API', evidence: 'In Go, at Globex.' },
    { skill: 'PostgreSQL', evidence: 'Ran Postgres in production.' },
  ],
  missing_skills: [
    { skill: 'SQL', posting_quote: 'Strong SQL' },
    { skill: 'Kafka', posting_quote: 'Experience with Kafka' },
  ],
};

test('Score fit answers with the cleaned analysis, and the job reads labels as strings (#354)', async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-fit-output-'));
  const savedAgent = process.env.AGENT_SERVICE_URL;
  delete process.env.DATABASE_URL;
  process.chdir(tempDir);
  await resetJobStoreForTests();
  resetUsageStoreForTests();
  const agent = await listen((request, response) => {
    request.resume();
    const answer = request.url?.startsWith('/score-fit') ? RAW_SCORE : fakeAgentAnswer(request.url);
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer));
  });
  process.env.AGENT_SERVICE_URL = agent.url;
  const api = await listen(createApp());
  try {
    await upsertUserProfile(USER, { resumeText: 'Backend engineer. Go, Postgres.' });
    const job = await createJob(USER, { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs in Go.' });

    const response = await fetch(`${api.url}/api/ai/score-fit`, {
      method: 'POST',
      headers: { 'X-User-Id': USER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: job.id }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.fit_score, FAKE_FIT_SCORE.fit_score);
    assert.equal(body.confidence_score, 65);
    assert.deepEqual(body.sub_signals, {
      skills_match: 80,
      title_seniority: 70,
      salary_fit: null,
      sponsorship_likelihood: null,
    });
    assert.deepEqual(body.matched_skills, ['Go', 'PostgreSQL']);
    assert.deepEqual(body.matched_skill_details, [
      { skill: 'Go', evidence: 'built the billing API In Go, at Globex.' },
      { skill: 'PostgreSQL', evidence: 'Ran Postgres in production.' },
    ]);
    assert.deepEqual(body.missing_skills, ['Kafka']);
    assert.deepEqual(body.missing_skill_details, [{ skill: 'Kafka', posting_quote: 'Experience with Kafka' }]);

    // The job page and any web version read the same analysis.
    const read = await fetch(`${api.url}/api/jobs/${job.id}`, { headers: { 'X-User-Id': USER } });
    const {
      job: { analysis },
    } = (await read.json()) as {
      job: { analysis: { matchedSkills: unknown[]; missingSkills: unknown[]; matchedSkillDetails: unknown[] } };
    };
    assert.deepEqual(analysis.matchedSkills, ['Go', 'PostgreSQL']);
    assert.deepEqual(analysis.missingSkills, ['Kafka']);
    assert.equal(analysis.matchedSkillDetails.length, 2);
  } finally {
    if (savedAgent === undefined) delete process.env.AGENT_SERVICE_URL;
    else process.env.AGENT_SERVICE_URL = savedAgent;
    await api.close();
    await agent.close();
    process.chdir(originalCwd);
    await resetJobStoreForTests();
    resetUsageStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});
