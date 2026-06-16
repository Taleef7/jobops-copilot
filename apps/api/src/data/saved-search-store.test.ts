import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  listUsersWithSavedSearches,
  resetSavedSearchStoreForTests,
} from './saved-search-store';

const USER = 'user_test';

test('saved searches round-trip, trim input, and stay user-scoped', async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-saved-search-'));
  try {
    process.chdir(tempDir);
    resetSavedSearchStoreForTests();

    assert.equal((await listSavedSearches(USER)).length, 0);

    const created = await createSavedSearch(USER, {
      query: ' AI Engineer ',
      location: ' Remote ',
      remoteOnly: true,
    });
    assert.equal(created.query, 'AI Engineer');
    assert.equal(created.location, 'Remote');
    assert.equal(created.remoteOnly, true);

    assert.equal((await listSavedSearches(USER)).length, 1);
    assert.equal((await listSavedSearches('user_other')).length, 0);
    assert.deepEqual(await listUsersWithSavedSearches(), [USER]);

    // Cannot delete another user's search.
    assert.equal(await deleteSavedSearch('user_other', created.id), false);
    assert.equal(await deleteSavedSearch(USER, created.id), true);
    assert.equal((await listSavedSearches(USER)).length, 0);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});
