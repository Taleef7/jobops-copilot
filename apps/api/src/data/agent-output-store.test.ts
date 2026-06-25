import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listAgentOutputs,
  resetAgentOutputStoreForTests,
  saveAgentOutput,
} from './agent-output-store';

async function withTempStore(run: () => Promise<void>) {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL; // force the file store
  const dir = await mkdtemp(join(tmpdir(), 'jobops-agent-outputs-'));
  try {
    process.chdir(dir);
    resetAgentOutputStoreForTests();
    await run();
  } finally {
    process.chdir(originalCwd);
    resetAgentOutputStoreForTests();
    await rm(dir, { recursive: true, force: true });
  }
}

test('saveAgentOutput upserts one row per (job, kind)', async () => {
  await withTempStore(async () => {
    await saveAgentOutput('u1', 'job-1', 'interview_prep', { v: 1 }, 'model-a');
    await saveAgentOutput('u1', 'job-1', 'interview_prep', { v: 2 }, 'model-b');

    const outputs = await listAgentOutputs('u1', 'job-1');
    assert.equal(outputs.length, 1);
    assert.deepEqual(outputs[0]?.payload, { v: 2 });
    assert.equal(outputs[0]?.modelUsed, 'model-b');
    assert.equal(outputs[0]?.kind, 'interview_prep');
  });
});

test('listAgentOutputs returns all kinds for a job, scoped to the user', async () => {
  await withTempStore(async () => {
    await saveAgentOutput('u1', 'job-1', 'interview_prep', { a: 1 });
    await saveAgentOutput('u1', 'job-1', 'research', { b: 2 });
    await saveAgentOutput('u2', 'job-1', 'skill_gap', { c: 3 }); // other user, same job

    const mine = await listAgentOutputs('u1', 'job-1');
    assert.deepEqual(mine.map((o) => o.kind).sort(), ['interview_prep', 'research']);

    const other = await listAgentOutputs('u2', 'job-1');
    assert.deepEqual(other.map((o) => o.kind), ['skill_gap']);
  });
});

test('saveAgentOutput does not let one user overwrite another user output', async () => {
  await withTempStore(async () => {
    await saveAgentOutput('u1', 'job-1', 'interview_prep', { owner: 'u1' });
    await saveAgentOutput('u2', 'job-1', 'interview_prep', { owner: 'u2' }); // same job + kind

    const u1 = await listAgentOutputs('u1', 'job-1');
    assert.equal(u1.length, 1);
    assert.deepEqual(u1[0]?.payload, { owner: 'u1' }); // intact, not clobbered

    const u2 = await listAgentOutputs('u2', 'job-1');
    assert.equal(u2.length, 1);
    assert.deepEqual(u2[0]?.payload, { owner: 'u2' });
  });
});

test('listAgentOutputs is empty for a job with no outputs', async () => {
  await withTempStore(async () => {
    assert.deepEqual(await listAgentOutputs('u1', 'job-x'), []);
  });
});
