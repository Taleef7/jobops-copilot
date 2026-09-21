import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  hashQuestion,
  listApplicationAnswers,
  findApplicationAnswer,
  upsertApplicationAnswer,
  deleteApplicationAnswer,
  _resetApplicationAnswerStoreForTests,
} from './application-answer-store';

async function withTempStore(run: () => Promise<void>) {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const dir = await mkdtemp(join(tmpdir(), 'jobops-answers-'));
  try {
    process.chdir(dir);
    await _resetApplicationAnswerStoreForTests([]);
    await run();
  } finally {
    process.chdir(originalCwd);
    await _resetApplicationAnswerStoreForTests([]);
    await rm(dir, { recursive: true, force: true });
  }
}

test('normalizes and hashes questions consistently', () => {
  const h1 = hashQuestion('Are you authorized to work in the US?');
  const h2 = hashQuestion('  are you AUTHORIZED to work in the US   ');
  const h3 = hashQuestion('Are you authorized to work in the US:');
  assert.equal(h1, h2);
  assert.equal(h1, h3);
  assert.match(h1, /^[a-f0-9]{64}$/);
});

test('upserts and lists application answers per user with tenant isolation', async () => {
  await withTempStore(async () => {
    const a1 = await upsertApplicationAnswer('u1', {
      questionText: 'Are you authorized to work in the US?',
      answer: 'Yes, I am a US citizen.',
      ats: 'greenhouse',
    });

    assert.ok(a1.id);
    assert.equal(a1.userId, 'u1');
    assert.equal(a1.answer, 'Yes, I am a US citizen.');
    assert.equal(a1.ats, 'greenhouse');

    const list = await listApplicationAnswers('u1');
    assert.equal(list.length, 1);
    assert.equal(list[0]?.questionText, 'Are you authorized to work in the US?');

    // Tenant isolation
    const listU2 = await listApplicationAnswers('u2');
    assert.equal(listU2.length, 0);
  });
});

test('updates existing answer on same question hash (upsert/idempotent)', async () => {
  await withTempStore(async () => {
    await upsertApplicationAnswer('u1', {
      questionText: 'What are your salary expectations?',
      answer: '$150,000 USD',
    });

    const updated = await upsertApplicationAnswer('u1', {
      questionText: 'What are your salary expectations? ',
      answer: '$160,000 - $180,000 USD',
    });

    const list = await listApplicationAnswers('u1');
    assert.equal(list.length, 1);
    assert.equal(list[0]?.answer, '$160,000 - $180,000 USD');
    assert.equal(updated.id, list[0]?.id);
  });
});

test('finds answer by question text or hash', async () => {
  await withTempStore(async () => {
    const created = await upsertApplicationAnswer('u1', {
      questionText: 'Do you require visa sponsorship?',
      answer: 'No',
    });

    const foundByText = await findApplicationAnswer('u1', 'Do you require visa sponsorship?');
    assert.equal(foundByText?.answer, 'No');

    const foundByHash = await findApplicationAnswer('u1', created.questionHash);
    assert.equal(foundByHash?.id, created.id);

    const notFound = await findApplicationAnswer('u1', 'How many years of Rust experience?');
    assert.equal(notFound, undefined);
  });
});

test('deletes an application answer by id', async () => {
  await withTempStore(async () => {
    const created = await upsertApplicationAnswer('u1', {
      questionText: 'Preferred pronouns?',
      answer: 'They/Them',
    });

    const deleted = await deleteApplicationAnswer('u1', created.id);
    assert.equal(deleted, true);

    const list = await listApplicationAnswers('u1');
    assert.equal(list.length, 0);

    const deletedAgain = await deleteApplicationAnswer('u1', created.id);
    assert.equal(deletedAgain, false);
  });
});
