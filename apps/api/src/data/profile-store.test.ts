import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getUserProfile, upsertUserProfile } from './profile-store';

async function withTempStore(run: () => Promise<void>) {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL; // force the file store
  const dir = await mkdtemp(join(tmpdir(), 'jobops-profile-'));
  try {
    process.chdir(dir);
    await run();
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

test('round-trips resume + profileText and carries no displayName (Phase 6)', async () => {
  await withTempStore(async () => {
    const saved = await upsertUserProfile('u1', {
      resumeText: 'my resume',
      resumeFileName: 'cv.pdf',
      profileText: 'profile grounding',
    });
    assert.equal('displayName' in saved, false);
    assert.equal(saved.resumeText, 'my resume');
    assert.equal(saved.profileText, 'profile grounding');

    const got = await getUserProfile('u1');
    assert.equal(got?.resumeFileName, 'cv.pdf');
    assert.equal(got?.profileText, 'profile grounding');
    assert.equal((got as unknown as Record<string, unknown>).displayName, undefined);
  });
});

test('a later upsert preserves prior fields (coalesce semantics)', async () => {
  await withTempStore(async () => {
    await upsertUserProfile('u1', { resumeText: 'R', resumeFileName: 'cv.pdf' });
    await upsertUserProfile('u1', { profileText: 'P' });

    const got = await getUserProfile('u1');
    assert.equal(got?.resumeText, 'R');
    assert.equal(got?.resumeFileName, 'cv.pdf');
    assert.equal(got?.profileText, 'P');
  });
});
