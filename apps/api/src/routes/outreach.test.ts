import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import express from 'express';
import { appendOutreachDraft, createJob, resetJobStoreForTests } from '@/data/job-store';
import { upsertUserProfile } from '@/data/profile-store';
import { apiErrorHandler } from '@/lib/api-error-handler';
import { flat, readPdf } from '@/test-support/pdf-read';
import { TAILOR_BASE } from '@/test-support/tailor-fixtures';
import { outreachRouter, validateOutreachUpdateBody } from './outreach';

test('rejects an empty status string instead of treating it as missing', () => {
  const result = validateOutreachUpdateBody({ status: '' });

  assert.equal(result.normalized.status, undefined);
  assert.equal(result.errors.status, 'Invalid outreach status.');
});

test('trims and accepts a valid status', () => {
  const result = validateOutreachUpdateBody({ status: ' sent ' });

  assert.equal(result.normalized.status, 'sent');
  assert.deepEqual(result.errors, {});
});

// #416: the outreach drafter no longer writes cover letters, but one saved before still downloads.
test('a legacy cover letter outreach draft still downloads as a PDF', async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-legacy-letter-'));
  delete process.env.DATABASE_URL;
  process.chdir(tempDir);
  await resetJobStoreForTests();
  const app = express();
  app.use((request, _response, next) => {
    request.userId = 'user-legacy';
    next();
  });
  app.use('/api/outreach', outreachRouter);
  app.use(apiErrorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const job = await createJob('user-legacy', { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs.' });
    await upsertUserProfile('user-legacy', { baseResume: TAILOR_BASE });
    const id = randomUUID();
    await appendOutreachDraft('user-legacy', job.id, {
      id,
      jobId: job.id,
      messageType: 'cover_letter',
      draftText: 'Dear Acme team,\n\nI build payment APIs in Go.\n\nSincerely,\nJordan Lee',
      status: 'drafted',
      createdAt: new Date().toISOString(),
    });
    const port = (server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/outreach/${id}/download-pdf`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    const { pages, text } = await readPdf(new Uint8Array(await response.arrayBuffer()));
    assert.equal(pages.length, 1);
    assert.ok(flat(text).includes('I build payment APIs in Go.'));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.chdir(originalCwd);
    await resetJobStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});
