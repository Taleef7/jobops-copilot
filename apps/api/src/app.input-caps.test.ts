import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from './app';
import { createJob, resetJobStoreForTests } from '@/data/job-store';

/** #345: stored text has a ceiling, so a huge posting or résumé is refused up front. */
test('over-long job and résumé text is refused with a plain message', async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-caps-'));
  delete process.env.DATABASE_URL;
  process.chdir(tempDir);
  await resetJobStoreForTests();
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  const base = `http://127.0.0.1:${address.port}`;
  const send = (method: string, path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'X-User-Id': 'u_caps', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const job = { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs.' };
  try {
    const huge = await send('POST', '/api/jobs', { ...job, descriptionText: 'x'.repeat(100_001) });
    assert.equal(huge.status, 413);
    assert.match(((await huge.json()) as { error: string }).error, /100,000 characters/);
    assert.equal((await send('POST', '/api/jobs', { ...job, descriptionText: 'x'.repeat(100_000) })).status, 201);

    const longTitle = await send('POST', '/api/jobs', { ...job, title: 't'.repeat(301) });
    assert.equal(longTitle.status, 400);
    assert.ok(((await longTitle.json()) as { fields: Record<string, string> }).fields.title);
    assert.equal((await send('POST', '/api/jobs', { ...job, company: 'c'.repeat(301) })).status, 400);
    assert.equal((await send('POST', '/api/jobs', { ...job, notes: 'n'.repeat(10_001) })).status, 400);

    const existing = await createJob('u_caps', { company: 'Globex', title: 'Engineer', descriptionText: 'x' });
    assert.equal((await send('PATCH', `/api/jobs/${existing.id}`, { notes: 'n'.repeat(10_001) })).status, 400);
    assert.equal((await send('PATCH', `/api/jobs/${existing.id}`, { nextAction: 'a'.repeat(10_001) })).status, 400);
    assert.equal((await send('PATCH', `/api/jobs/${existing.id}`, { notes: 'Called the recruiter' })).status, 200);

    assert.equal((await send('POST', '/api/profile/resume', { resume_text: 'r'.repeat(100_001) })).status, 413);
    assert.equal((await send('PUT', '/api/profile', { profileText: 'p'.repeat(100_001) })).status, 413);
    assert.equal((await send('POST', '/api/profile/resume', { resume_text: 'Backend engineer.' })).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.chdir(originalCwd);
    await resetJobStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});
