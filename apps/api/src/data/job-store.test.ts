import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendOutreachDraft,
  countJobs,
  createJob,
  getJobById,
  listJobs,
  resetJobStoreForTests,
  saveJobAnalysis,
  updateJob,
  getJobStatusEvents,
  updateOutreachDraft,
} from './job-store';
import { ANALYZED_NEXT_ACTION, UNSCORED_NEXT_ACTION } from '@/lib/analysis-workflow';
import { PRERANK_MODEL } from '@/lib/local-fit';
import type { OutreachDraft } from '@/types';
import { sampleAnalysis } from '@/test-support/analysis';

function draft(text: string): OutreachDraft {
  return {
    id: `outreach-${text}`,
    contactName: 'Pat',
    contactRole: 'Recruiter',
    messageType: 'recruiter_email',
    draftText: text,
    status: 'drafted',
    createdAt: new Date().toISOString(),
  };
}

test('appendOutreachDraft replaces the previous unsent draft per job', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL; // force the file store
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-outreach-'));

  try {
    process.chdir(tempDir);
    resetJobStoreForTests();

    const job = await createJob('user-1', {
      company: 'Acme',
      title: 'Engineer',
      descriptionText: 'Build things with TypeScript and React.',
    });

    await appendOutreachDraft('user-1', job.id, draft('first'));
    await appendOutreachDraft('user-1', job.id, draft('second'));

    const fetched = await getJobById('user-1', job.id);
    // The superseded draft is dropped; only the most recent draft remains.
    assert.equal(fetched?.outreach.length, 1);
    assert.equal(fetched?.outreach[0]?.draftText, 'second');
  } finally {
    process.chdir(originalCwd);
    resetJobStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('appendOutreachDraft preserves sent outreach history', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL; // force the file store
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-outreach-'));

  try {
    process.chdir(tempDir);
    resetJobStoreForTests();

    const job = await createJob('user-1', {
      company: 'Acme',
      title: 'Engineer',
      descriptionText: 'Build things with TypeScript and React.',
    });

    // First draft gets approved and sent — this is real history.
    await appendOutreachDraft('user-1', job.id, draft('first'));
    await updateOutreachDraft('user-1', 'outreach-first', { status: 'sent' });

    // Generating a fresh draft must not wipe the sent record.
    await appendOutreachDraft('user-1', job.id, draft('second'));

    const fetched = await getJobById('user-1', job.id);
    const texts = (fetched?.outreach ?? []).map((entry) => entry.draftText).sort();
    assert.deepEqual(texts, ['first', 'second']);

    const sent = fetched?.outreach.find((entry) => entry.id === 'outreach-first');
    assert.equal(sent?.status, 'sent');
  } finally {
    process.chdir(originalCwd);
    resetJobStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('listJobs paginates (opt-in) and stays user-scoped; countJobs reports the total', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL; // force the file store
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-jobs-page-'));

  try {
    process.chdir(tempDir);
    resetJobStoreForTests();

    for (let i = 0; i < 5; i += 1) {
      await createJob('user-1', {
        company: `Acme ${i}`,
        title: `Engineer ${i}`,
        descriptionText: 'Build things.',
      });
    }
    await createJob('user-2', { company: 'Other', title: 'Dev', descriptionText: 'x' });

    // No page params → full list (backward-compatible), user-scoped.
    assert.equal((await listJobs('user-1')).length, 5);
    assert.equal((await listJobs('user-2')).length, 1);
    assert.equal(await countJobs('user-1'), 5);

    // Opt-in pagination slices the list without leaking across users.
    assert.equal((await listJobs('user-1', { limit: 2, offset: 0 })).length, 2);
    assert.equal((await listJobs('user-1', { limit: 2, offset: 4 })).length, 1);
    assert.equal((await listJobs('user-1', { limit: 2, offset: 99 })).length, 0);
  } finally {
    process.chdir(originalCwd);
    resetJobStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});

// The file store takes its own branch in saveJobAnalysis, so the Postgres
// integration test above it proves nothing here. Before this, a scored job
// kept telling you to score it.
test('saveJobAnalysis advances the next action only for a real scoring run', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL; // force the file store
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-nextaction-'));

  try {
    process.chdir(tempDir);
    resetJobStoreForTests();

    const scoredJob = await createJob('user-1', {
      company: 'Acme',
      title: 'Engineer',
      descriptionText: 'Build things with TypeScript and React.',
    });
    assert.equal(scoredJob.nextAction, UNSCORED_NEXT_ACTION, 'a new job asks to be scored');

    await saveJobAnalysis('user-1', scoredJob.id, sampleAnalysis({ modelUsed: 'gpt-4o' }), 77);
    assert.equal(
      (await getJobById('user-1', scoredJob.id))?.nextAction,
      ANALYZED_NEXT_ACTION,
      'a scored job stops asking to be scored',
    );

    // A pre-rank that clears the evidence floor DOES carry a number, so this
    // must be excluded by its model, not by the absence of a score.
    const estimatedJob = await createJob('user-1', {
      company: 'Hooli',
      title: 'Data Engineer',
      descriptionText: 'Airflow and dbt.',
    });

    await saveJobAnalysis(
      'user-1',
      estimatedJob.id,
      sampleAnalysis({ modelUsed: PRERANK_MODEL }),
      100,
    );
    assert.equal(
      (await getJobById('user-1', estimatedJob.id))?.nextAction,
      UNSCORED_NEXT_ACTION,
      'discovery’s keyword estimate is not a scoring run',
    );

    // POST /ai/parse-job saves an analysis with no fitScore at all. That is a
    // parse, not a scoring run, so the prompt to score has to survive it.
    const parsedJob = await createJob('user-1', {
      company: 'Initech',
      title: 'Platform Engineer',
      descriptionText: 'Kubernetes and Go.',
    });

    await saveJobAnalysis('user-1', parsedJob.id, sampleAnalysis());
    assert.equal(
      (await getJobById('user-1', parsedJob.id))?.nextAction,
      UNSCORED_NEXT_ACTION,
      'a parse with no score is not a scoring run',
    );
  } finally {
    process.chdir(originalCwd);
    resetJobStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('createJob round-trips enriched schema fields (salary, seniority, contentHash, liveness)', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL; // force the file store
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-enriched-'));

  try {
    process.chdir(tempDir);
    resetJobStoreForTests();

    const created = await createJob('user-1', {
      company: 'Acme Corp',
      title: 'Senior Engineer',
      descriptionText: 'Lead team building scalable APIs.',
      salaryMin: 150000,
      salaryMax: 180000,
      salaryCurrency: 'USD',
      seniority: 'senior',
      contentHash: 'a'.repeat(64),
      liveness: 'active',
    });

    const fetched = await getJobById('user-1', created.id);
    assert.equal(fetched?.salaryMin, 150000);
    assert.equal(fetched?.salaryMax, 180000);
    assert.equal(fetched?.salaryCurrency, 'USD');
    assert.equal(fetched?.seniority, 'senior');
    assert.equal(fetched?.contentHash, 'a'.repeat(64));
    assert.equal(fetched?.liveness, 'active');
  } finally {
    process.chdir(originalCwd);
    resetJobStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('status events are persisted to job-status-events.json in file mode and survive store reset', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL; // force the file store
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-status-events-'));

  try {
    process.chdir(tempDir);
    resetJobStoreForTests();

    const created = await createJob('user-1', {
      company: 'Acme Corp',
      title: 'Engineer',
      descriptionText: 'Building systems.',
    });

    // Move to applied then interview
    await updateJob('user-1', created.id, { status: 'applied' });
    await updateJob('user-1', created.id, { status: 'interview' });

    // Verify events recorded
    const eventsBeforeReset = await getJobStatusEvents('user-1');
    assert.equal(eventsBeforeReset.length, 3);
    assert.equal(eventsBeforeReset[0]?.fromStatus, null);
    assert.equal(eventsBeforeReset[0]?.toStatus, 'discovered');
    assert.equal(eventsBeforeReset[1]?.fromStatus, 'discovered');
    assert.equal(eventsBeforeReset[1]?.toStatus, 'applied');
    assert.equal(eventsBeforeReset[2]?.fromStatus, 'applied');
    assert.equal(eventsBeforeReset[2]?.toStatus, 'interview');

    // Simulate server restart: reset in-memory caches
    resetJobStoreForTests();

    // Verify events reloaded from file
    const eventsAfterReset = await getJobStatusEvents('user-1');
    assert.equal(eventsAfterReset.length, 3);
    assert.equal(eventsAfterReset[0]?.fromStatus, null);
    assert.equal(eventsAfterReset[0]?.toStatus, 'discovered');
    assert.equal(eventsAfterReset[1]?.fromStatus, 'discovered');
    assert.equal(eventsAfterReset[1]?.toStatus, 'applied');
    assert.equal(eventsAfterReset[2]?.fromStatus, 'applied');
    assert.equal(eventsAfterReset[2]?.toStatus, 'interview');
  } finally {
    process.chdir(originalCwd);
    resetJobStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('createJob bounds stored text for every writer, not just POST /api/jobs (#345)', async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-job-caps-'));
  delete process.env.DATABASE_URL;
  process.chdir(tempDir);
  await resetJobStoreForTests();
  try {
    // Discovery and the n8n intake call createJob directly.
    const job = await createJob('u_store_caps', {
      company: 'c'.repeat(400),
      title: 't'.repeat(400),
      descriptionText: 'd'.repeat(150_000),
      notes: 'n'.repeat(20_000),
    });
    assert.equal(job.descriptionText.length, 100_000);
    assert.equal(job.company.length, 300);
    assert.equal(job.title.length, 300);
    assert.equal(job.notes?.length, 10_000);
  } finally {
    process.chdir(originalCwd);
    await resetJobStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('the file store saves a 0–1 confidence as a percentage and reads old rows in the new shape (#354)', async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-fit-output-'));
  delete process.env.DATABASE_URL;
  process.chdir(tempDir);
  resetJobStoreForTests();
  try {
    const job = await createJob('user-1', { company: 'Acme', title: 'Engineer', descriptionText: 'Go and Kafka.' });
    await saveJobAnalysis('user-1', job.id, sampleAnalysis({ confidenceScore: 0.65 }), 70);
    const saved = (await getJobById('user-1', job.id))?.analysis;
    assert.equal(saved?.confidenceScore, 65);
    assert.deepEqual(saved?.matchedSkills, ['Go']);
    assert.deepEqual(saved?.matchedSkillDetails, [{ skill: 'Go', evidence: 'Built the billing API in Go.' }]);

    // A row written before #354: skills as "label: why" strings, no details, a 0–1 confidence.
    const stored = JSON.parse(await readFile(join(tempDir, 'data', 'jobs.json'), 'utf8')) as Array<Record<string, unknown>>;
    const row = stored.find((entry) => entry.id === job.id)!;
    const old = { ...(row.analysis as Record<string, unknown>) };
    delete old.matchedSkillDetails;
    delete old.missingSkillDetails;
    row.analysis = {
      ...old,
      matchedSkills: ['Go: built the billing API in Go'],
      missingSkills: ['Kafka'],
      confidenceScore: 0.8,
    };
    await writeFile(join(tempDir, 'data', 'jobs.json'), JSON.stringify(stored));
    resetJobStoreForTests();

    const analysis = (await getJobById('user-1', job.id))?.analysis;
    assert.deepEqual(analysis?.matchedSkills, ['Go']);
    assert.deepEqual(analysis?.matchedSkillDetails, [{ skill: 'Go', evidence: 'built the billing API in Go' }]);
    assert.deepEqual(analysis?.missingSkills, ['Kafka']);
    assert.deepEqual(analysis?.missingSkillDetails, [{ skill: 'Kafka', postingQuote: '' }]);
    assert.equal(analysis?.confidenceScore, 80);
  } finally {
    process.chdir(originalCwd);
    resetJobStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});

// #355: a job added without a location, workplace or employment type was stored as
// "Remote", "remote" and "Full-time". What the posting doesn't state stays unstated.
test('createJob stores no location, workplace or employment type it was not given', async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-unstated-'));
  delete process.env.DATABASE_URL;
  process.chdir(tempDir);
  await resetJobStoreForTests();
  try {
    const unstated = await createJob('u_unstated', { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs.' });
    for (const job of [unstated, await getJobById('u_unstated', unstated.id)]) {
      assert.equal(job?.location, '');
      assert.equal(job?.workplaceType, null);
      assert.equal(job?.employmentType, '');
    }

    const stated = await createJob('u_unstated', {
      company: 'Globex',
      title: 'Engineer',
      descriptionText: 'Build APIs in London.',
      location: 'London, United Kingdom',
      workplaceType: 'hybrid',
      employmentType: 'Contract',
    });
    const fetched = await getJobById('u_unstated', stated.id);
    assert.equal(fetched?.location, 'London, United Kingdom');
    assert.equal(fetched?.workplaceType, 'hybrid');
    assert.equal(fetched?.employmentType, 'Contract');
  } finally {
    process.chdir(originalCwd);
    await resetJobStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});
