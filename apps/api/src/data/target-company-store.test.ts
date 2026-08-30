import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  clearUserTargetCompanies,
  createTargetCompany,
  deleteTargetCompany,
  listEnabledTargetCompanies,
  listTargetCompanies,
  resetTargetCompanyStoreForTests,
  setTargetCompanyEnabled,
} from './target-company-store';

const USER = 'user_tc_store_test';

test('target companies round-trip CRUD and stay user-scoped', async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-tc-store-'));
  try {
    process.chdir(tempDir);
    resetTargetCompanyStoreForTests();

    assert.equal((await listTargetCompanies(USER)).length, 0);

    const created = await createTargetCompany(USER, {
      company: ' Stripe ',
      boardType: 'greenhouse',
      boardToken: 'stripe',
    });
    assert.equal(created.company, ' Stripe ');
    assert.equal(created.boardType, 'greenhouse');
    assert.equal(created.boardToken, 'stripe');
    assert.equal(created.enabled, true);
    assert.ok(created.id);

    assert.equal((await listTargetCompanies(USER)).length, 1);
    assert.equal((await listTargetCompanies('user_other')).length, 0);

    // Toggle enabled off
    const toggled = await setTargetCompanyEnabled(USER, created.id, false);
    assert.ok(toggled);
    assert.equal(toggled!.enabled, false);

    // listEnabled should exclude it
    assert.equal((await listEnabledTargetCompanies(USER)).length, 0);

    // Toggle back on
    const reEnabled = await setTargetCompanyEnabled(USER, created.id, true);
    assert.ok(reEnabled);
    assert.equal(reEnabled!.enabled, true);
    assert.equal((await listEnabledTargetCompanies(USER)).length, 1);

    // Cannot delete another user's entry
    assert.equal(await deleteTargetCompany('user_other', created.id), false);
    assert.equal(await deleteTargetCompany(USER, created.id), true);
    assert.equal((await listTargetCompanies(USER)).length, 0);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('setTargetCompanyEnabled returns undefined for unknown id', async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-tc-store-undef-'));
  try {
    process.chdir(tempDir);
    resetTargetCompanyStoreForTests();

    const result = await setTargetCompanyEnabled(USER, 'does-not-exist', false);
    assert.equal(result, undefined);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('clearUserTargetCompanies removes only the target user records', async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-tc-store-clear-'));
  try {
    process.chdir(tempDir);
    resetTargetCompanyStoreForTests();

    await createTargetCompany(USER, { company: 'Stripe', boardType: 'greenhouse', boardToken: 'stripe' });
    await createTargetCompany('other_user', { company: 'Linear', boardType: 'ashby', boardToken: 'linear' });

    assert.equal((await listTargetCompanies(USER)).length, 1);
    assert.equal((await listTargetCompanies('other_user')).length, 1);

    await clearUserTargetCompanies(USER);

    assert.equal((await listTargetCompanies(USER)).length, 0);
    assert.equal((await listTargetCompanies('other_user')).length, 1);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});
