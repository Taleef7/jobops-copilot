import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendOutreachDraft,
  createJob,
  getJobById,
  resetJobStoreForTests,
  updateOutreachDraft,
} from './job-store';
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
