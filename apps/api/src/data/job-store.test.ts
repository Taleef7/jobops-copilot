import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendOutreachDraft, createJob, getJobById, resetJobStoreForTests } from './job-store';
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

test('appendOutreachDraft keeps only the latest draft per job', async () => {
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
    // Only the most recent draft is kept (replace, not append).
    assert.equal(fetched?.outreach.length, 1);
    assert.equal(fetched?.outreach[0]?.draftText, 'second');
  } finally {
    process.chdir(originalCwd);
    resetJobStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});
