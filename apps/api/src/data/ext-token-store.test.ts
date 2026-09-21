import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  hashToken,
  createExtToken,
  listExtTokens,
  findExtTokenByHash,
  touchExtToken,
  revokeExtToken,
  _resetExtTokenStoreForTests,
} from './ext-token-store';

async function withTempStore(run: () => Promise<void>) {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const dir = await mkdtemp(join(tmpdir(), 'jobops-tokens-'));
  try {
    process.chdir(dir);
    await _resetExtTokenStoreForTests([]);
    await run();
  } finally {
    process.chdir(originalCwd);
    await _resetExtTokenStoreForTests([]);
    await rm(dir, { recursive: true, force: true });
  }
}

test('hashes tokens deterministically with sha256', () => {
  const h1 = hashToken('jop_123456');
  const h2 = hashToken('jop_123456');
  assert.equal(h1, h2);
  assert.match(h1, /^[a-f0-9]{64}$/);
});

test('creates token and returns raw token and stored record', async () => {
  await withTempStore(async () => {
    const { token, record } = await createExtToken('u1', 'Chrome Work Laptop');
    assert.match(token, /^jop_[a-f0-9]{48}$/);
    assert.ok(record.id);
    assert.equal(record.userId, 'u1');
    assert.equal(record.label, 'Chrome Work Laptop');
    assert.equal(record.tokenHash, hashToken(token));

    const list = await listExtTokens('u1');
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, record.id);

    // Tenant isolation
    const listU2 = await listExtTokens('u2');
    assert.equal(listU2.length, 0);
  });
});

test('finds active token by hash and touches lastUsedAt', async () => {
  await withTempStore(async () => {
    const { record } = await createExtToken('u1', 'Chrome Extension');
    const found = await findExtTokenByHash(record.tokenHash);
    assert.ok(found);
    assert.equal(found?.userId, 'u1');

    await touchExtToken(record.tokenHash);
    const updated = await findExtTokenByHash(record.tokenHash);
    assert.ok(updated?.lastUsedAt);
  });
});

test('revoking a token prevents finding it by hash', async () => {
  await withTempStore(async () => {
    const { record } = await createExtToken('u1');
    const revoked = await revokeExtToken('u1', record.id);
    assert.equal(revoked, true);

    const found = await findExtTokenByHash(record.tokenHash);
    assert.equal(found, undefined);

    // Revoking again returns false
    const revokedAgain = await revokeExtToken('u1', record.id);
    assert.equal(revokedAgain, false);
  });
});
