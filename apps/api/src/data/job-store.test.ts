import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
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
  updateOutreachDraft,
} from './job-store';
import { ANALYZED_NEXT_ACTION, UNSCORED_NEXT_ACTION } from '@/lib/analysis-workflow';
import { PRERANK_MODEL } from '@/lib/local-fit';
import type { OutreachDraft } from '@/types';

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

    await saveJobAnalysis('user-1', scoredJob.id, { ...scoredJob.analysis, modelUsed: 'gpt-4o' }, 77);
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
      { ...estimatedJob.analysis, modelUsed: PRERANK_MODEL },
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

    await saveJobAnalysis('user-1', parsedJob.id, {
      ...parsedJob.analysis,
      modelUsed: 'mock-analysis-v1',
    });
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
