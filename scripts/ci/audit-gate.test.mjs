import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkAudit } from './audit-gate.mjs';

// npm audit --json (report version 2): an advisory is a `via` object on the package it is
// in; the packages that only depend on it carry its name as a string.
function report(...advisories) {
  const vulnerabilities = {};
  for (const { pkg, id, severity, dependant } of advisories) {
    vulnerabilities[pkg] = {
      name: pkg,
      severity,
      via: [{ source: 1, name: pkg, title: `${pkg} advisory`, url: `https://github.com/advisories/${id}`, severity }],
    };
    if (dependant) vulnerabilities[dependant] = { name: dependant, severity, via: [pkg] };
  }
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: {} } };
}

const MSAL = { pkg: '@azure/msal-node', id: 'GHSA-xcx6-jx8p-x3h5', severity: 'high', dependant: '@azure/identity' };
const allowed = (overrides = {}) => ({
  id: 'GHSA-xcx6-jx8p-x3h5',
  package: '@azure/msal-node',
  expires: '2026-11-28',
  reason: 'auth-code flow unused',
  ...overrides,
});

test('a clean report passes', () => {
  assert.deepEqual(checkAudit(report(), [], '2026-10-29', 'high').failures, []);
});

test('an advisory at or above the level fails; the package that only depends on it is not counted again', () => {
  const { failures } = checkAudit(report(MSAL), [], '2026-10-29', 'high');
  assert.equal(failures.length, 1);
  assert.match(failures[0], /GHSA-xcx6-jx8p-x3h5/);
  assert.match(failures[0], /@azure\/msal-node/);
});

test('an advisory below the level passes', () => {
  const moderate = { pkg: 'qs', id: 'GHSA-6pq8-jhm2-2vcw', severity: 'moderate' };
  assert.deepEqual(checkAudit(report(moderate), [], '2026-10-29', 'high').failures, []);
  assert.equal(checkAudit(report(moderate), [], '2026-10-29', 'moderate').failures.length, 1);
});

test('an allowed advisory passes until its expiry date, inclusive', () => {
  assert.deepEqual(checkAudit(report(MSAL), [allowed()], '2026-11-28', 'high').failures, []);
  // The day after: the entry has expired, and its advisory fails again.
  const { failures } = checkAudit(report(MSAL), [allowed()], '2026-11-29', 'high');
  assert.equal(failures.length, 2);
  assert.match(failures[0], /expired on 2026-11-28/);
  assert.match(failures[1], /^high GHSA-xcx6-jx8p-x3h5 in @azure\/msal-node/);
});

test('an expired entry fails even once its advisory is gone, so it gets removed', () => {
  const { failures } = checkAudit(report(), [allowed({ expires: '2026-10-01' })], '2026-10-29', 'high');
  assert.equal(failures.length, 1);
  assert.match(failures[0], /expired/);
});

test('an entry allows its advisory only in the package it names', () => {
  const elsewhere = { ...MSAL, pkg: 'some-fork-of-msal', dependant: undefined };
  assert.equal(checkAudit(report(elsewhere), [allowed()], '2026-10-29', 'high').failures.length, 1);
});

test('a critical advisory fails like a high one, and the allowlist names advisories, not packages', () => {
  const next = { pkg: 'next', id: 'GHSA-2464-fhr4-w9xw', severity: 'critical' };
  const { failures } = checkAudit(report(MSAL, next), [allowed()], '2026-10-29', 'high');
  assert.equal(failures.length, 1);
  assert.match(failures[0], /GHSA-2464-fhr4-w9xw/);
});

test('an entry whose advisory is gone is reported as unused, without failing', () => {
  const result = checkAudit(report(), [allowed()], '2026-10-29', 'high');
  assert.deepEqual(result.failures, []);
  assert.equal(result.unused.length, 1);
});

test('a malformed entry fails: it needs an id, a package, a reason and a YYYY-MM-DD expiry', () => {
  for (const entry of [allowed({ reason: '' }), allowed({ expires: 'next month' }), allowed({ package: undefined })]) {
    assert.ok(checkAudit(report(), [entry], '2026-10-29', 'high').failures.length > 0, JSON.stringify(entry));
  }
});

test("a report npm couldn't produce fails instead of passing as clean", () => {
  assert.ok(checkAudit({ error: { code: 'ENOAUDIT' } }, [], '2026-10-29', 'high').failures.length > 0);
  assert.ok(checkAudit({}, [], '2026-10-29', 'high').failures.length > 0);
});

test('a report in a shape the gate cannot read fails instead of passing as clean', () => {
  const unread = [
    { ...report(), auditReportVersion: 1 },
    // npm counts high findings, but none can be read from `vulnerabilities`.
    { ...report(), metadata: { vulnerabilities: { high: 3 } } },
    { ...report(), vulnerabilities: { next: { name: 'next', severity: 'critical' } } },
    { ...report(), vulnerabilities: { next: { name: 'next', severity: 'critical', via: 'next' } } },
  ];
  for (const shape of unread) {
    assert.ok(checkAudit(shape, [], '2026-10-29', 'high').failures.length > 0, JSON.stringify(shape));
  }
  // Counts below the level, with nothing to read at it, are fine; npm's `total` is not a severity.
  const moderateOnly = { info: 0, low: 0, moderate: 2, high: 0, critical: 0, total: 2 };
  assert.deepEqual(checkAudit({ ...report(), metadata: { vulnerabilities: moderateOnly } }, [], '2026-10-29', 'high').failures, []);
});

test('an expiry must be a real date at most 90 days away', () => {
  assert.deepEqual(checkAudit(report(MSAL), [allowed({ expires: '2027-01-27' })], '2026-10-29', 'high').failures, []);
  for (const expires of ['2027-01-28', '9999-12-31', '2026-02-30']) {
    assert.ok(checkAudit(report(), [allowed({ expires })], '2026-10-29', 'high').failures.length > 0, expires);
  }
});

test('only the entries that matched an advisory are reported as allowed', () => {
  const unused = allowed({ id: 'GHSA-0000-0000-0000', package: 'other' });
  const result = checkAudit(report(MSAL), [allowed(), unused], '2026-10-29', 'high');
  assert.deepEqual(result.allowed.map((entry) => entry.id), ['GHSA-xcx6-jx8p-x3h5']);
  assert.deepEqual(result.unused.map((entry) => entry.id), ['GHSA-0000-0000-0000']);
});

// The command CI runs, as a process: run straight or through a linked folder, it must gate.
test('the command fails on a bad report and passes a clean one, however it is reached', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-gate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const link = join(dir, 'linked');
  symlinkSync(dirname(fileURLToPath(import.meta.url)), link, 'junction');
  const allowlist = join(dir, 'allowlist.json');
  writeFileSync(allowlist, '[]');
  const garbage = join(dir, 'garbage.json');
  writeFileSync(garbage, 'not json');
  const clean = join(dir, 'clean.json');
  writeFileSync(clean, JSON.stringify(report()));

  for (const script of [fileURLToPath(new URL('./audit-gate.mjs', import.meta.url)), join(link, 'audit-gate.mjs')]) {
    const bad = spawnSync(process.execPath, [script, garbage, 'high', allowlist], { encoding: 'utf8' });
    assert.equal(bad.status, 1, `${script}: ${bad.stdout}${bad.stderr}`);
    const good = spawnSync(process.execPath, [script, clean, 'high', allowlist], { encoding: 'utf8' });
    assert.equal(good.status, 0, `${script}: ${good.stdout}${good.stderr}`);
    assert.match(good.stdout, /No high or worse advisories outside the allowlist/);
  }
});
