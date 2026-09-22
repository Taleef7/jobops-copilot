import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '@/app';
import { _resetApplicationAnswerStoreForTests } from '@/data/application-answer-store';
import type { ApplicationAnswer } from '@/types';

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Test server did not provide a usable address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const USER = 'user_answers_test';

function hdrs(userId?: string) {
  return {
    'Content-Type': 'application/json',
    ...(userId ? { 'X-User-Id': userId } : {}),
  };
}

test('GET /api/answers endpoint returns a valid response', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/answers`, {
      headers: hdrs(USER),
    });
    assert.equal(res.status, 200);
  });
});

test('POST, GET, DELETE /api/answers CRUD lifecycle', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-answers-test-'));

  try {
    process.chdir(tempDir);
    await _resetApplicationAnswerStoreForTests([]);

    await withServer(async (baseUrl) => {
      // 1. Initial list should be empty
      const listRes1 = await fetch(`${baseUrl}/api/answers`, { headers: hdrs(USER) });
      assert.equal(listRes1.status, 200);
      const listData1 = (await listRes1.json()) as { answers: ApplicationAnswer[] };
      assert.equal(listData1.answers.length, 0);

      // 2. Reject missing questionText or answer
      const badRes1 = await fetch(`${baseUrl}/api/answers`, {
        method: 'POST',
        headers: hdrs(USER),
        body: JSON.stringify({ questionText: '', answer: 'yes' }),
      });
      assert.equal(badRes1.status, 400);

      // 3. Create new answer
      const createRes = await fetch(`${baseUrl}/api/answers`, {
        method: 'POST',
        headers: hdrs(USER),
        body: JSON.stringify({
          questionText: 'Are you legally authorized to work in the United States?',
          answer: 'Yes',
          ats: 'greenhouse',
        }),
      });
      assert.equal(createRes.status, 201);
      const createData = (await createRes.json()) as { answer: ApplicationAnswer };
      assert.ok(createData.answer.id);
      assert.equal(createData.answer.answer, 'Yes');
      assert.equal(createData.answer.ats, 'greenhouse');
      const answerId = createData.answer.id;

      // 4. List answers
      const listRes2 = await fetch(`${baseUrl}/api/answers`, { headers: hdrs(USER) });
      assert.equal(listRes2.status, 200);
      const listData2 = (await listRes2.json()) as { answers: ApplicationAnswer[] };
      assert.equal(listData2.answers.length, 1);
      assert.equal(listData2.answers[0]?.id, answerId);

      // 5. Update answer (same question text)
      const updateRes = await fetch(`${baseUrl}/api/answers`, {
        method: 'POST',
        headers: hdrs(USER),
        body: JSON.stringify({
          questionText: 'Are you legally authorized to work in the United States? ',
          answer: 'Yes, authorized for any employer.',
        }),
      });
      assert.equal(updateRes.status, 201);
      const updateData = (await updateRes.json()) as { answer: ApplicationAnswer };
      assert.equal(updateData.answer.answer, 'Yes, authorized for any employer.');

      // List still has length 1
      const listRes3 = await fetch(`${baseUrl}/api/answers`, { headers: hdrs(USER) });
      const listData3 = (await listRes3.json()) as { answers: ApplicationAnswer[] };
      assert.equal(listData3.answers.length, 1);
      assert.equal(listData3.answers[0]?.answer, 'Yes, authorized for any employer.');

      // 6. Delete answer
      const deleteRes = await fetch(`${baseUrl}/api/answers/${answerId}`, {
        method: 'DELETE',
        headers: hdrs(USER),
      });
      assert.equal(deleteRes.status, 200);

      // 7. Delete again should return 404
      const deleteRes404 = await fetch(`${baseUrl}/api/answers/${answerId}`, {
        method: 'DELETE',
        headers: hdrs(USER),
      });
      assert.equal(deleteRes404.status, 404);

      // 8. List is empty again
      const listRes4 = await fetch(`${baseUrl}/api/answers`, { headers: hdrs(USER) });
      const listData4 = (await listRes4.json()) as { answers: ApplicationAnswer[] };
      assert.equal(listData4.answers.length, 0);
    });
  } finally {
    process.chdir(originalCwd);
    await _resetApplicationAnswerStoreForTests([]);
    await rm(tempDir, { recursive: true, force: true });
  }
});
