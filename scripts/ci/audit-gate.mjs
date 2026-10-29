#!/usr/bin/env node
/**
 * Gate on `npm audit --json`: fail on every advisory at or above a severity, except the ones
 * listed in `audit-allowlist.json`, each for one package and until a date.
 *
 * Usage: npm audit --omit=dev --json > audit.json; node scripts/ci/audit-gate.mjs audit.json high
 *
 * An entry exists because no fixed version can be installed yet and the affected code path
 * isn't reachable in this app; its reason says why. It names an advisory and the package
 * it's in, so the same advisory turning up somewhere else still fails. It expires within
 * 90 days, and an expired entry fails even after its advisory is gone, so nothing stays
 * allowed by forgetting about it. An entry whose advisory is gone is printed as unused, to
 * be removed, without failing: the upstream fix can land in a Dependabot bump.
 *
 * A report the gate can't read fails: passing it would read as "no advisories".
 */
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const MAX_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD as a UTC timestamp, or NaN unless it is a real calendar date. */
function dayOf(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text ?? '')) return Number.NaN;
  const time = Date.parse(`${text}T00:00:00Z`);
  return new Date(time).toISOString().slice(0, 10) === text ? time : Number.NaN;
}

/**
 * The advisories in a report (npm audit report version 2): one per advisory and package,
 * from the `via` objects. Returns null when a vulnerability can't be read.
 */
function advisoriesIn(report) {
  const found = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities)) {
    if (!Array.isArray(vulnerability?.via)) return null;
    for (const via of vulnerability.via) {
      // A string names the package this one depends on; that package lists the advisory.
      if (typeof via === 'string') continue;
      if (!via || typeof via !== 'object') return null;
      const id = /GHSA-[\w-]+/.exec(via.url ?? '')?.[0] ?? `npm-${via.source}`;
      found.set(`${id} ${via.name}`, { id, package: via.name, severity: via.severity, title: via.title });
    }
  }
  return [...found.values()];
}

// An unknown severity counts as critical.
const rank = (severity) => RANK[severity] ?? RANK.critical;

/**
 * Check an audit report against the allowlist on `today` (YYYY-MM-DD). Returns the failures
 * (empty means pass), the entries that allowed an advisory, and the ones nothing needs.
 */
export function checkAudit(report, allowlist, today, level) {
  const unreadable = (why) => ({ failures: [`npm audit report can't be read (${why}): ${JSON.stringify(report).slice(0, 300)}`], allowed: [], unused: [] });
  if (!report || report.error) return unreadable('npm reported an error');
  if (report.auditReportVersion !== 2) return unreadable('expected auditReportVersion 2');
  if (typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null || Array.isArray(report.vulnerabilities)) {
    return unreadable('no vulnerabilities object');
  }
  const advisories = advisoriesIn(report);
  if (!advisories) return unreadable('a vulnerability without a via list');
  const atLevel = advisories.filter((advisory) => rank(advisory.severity) >= RANK[level]);
  // npm's own counts at the level must be backed by advisories the gate can see (its
  // `total` key is a sum, not a severity).
  const counted = Object.entries(report.metadata?.vulnerabilities ?? {})
    .filter(([severity]) => severity in RANK && RANK[severity] >= RANK[level])
    .reduce((sum, [, count]) => sum + (Number(count) || 0), 0);
  if (counted > 0 && atLevel.length === 0) return unreadable(`npm counts ${counted} at ${level} or worse, none readable`);

  const failures = [];
  const valid = [];
  const now = dayOf(today);
  for (const entry of allowlist) {
    const expires = dayOf(entry?.expires);
    if (!entry?.id || !entry.package || !entry.reason?.trim() || Number.isNaN(expires)) {
      failures.push(`Allowlist entry needs an id, a package, a reason and a real YYYY-MM-DD expiry: ${JSON.stringify(entry)}`);
    } else if (expires < now) {
      failures.push(`Allowlist entry ${entry.id} (${entry.package}) expired on ${entry.expires}: fix it or decide again.`);
    } else if (expires - now > MAX_DAYS * DAY_MS) {
      failures.push(`Allowlist entry ${entry.id} (${entry.package}) expires ${entry.expires}, more than ${MAX_DAYS} days away.`);
    } else {
      valid.push(entry);
    }
  }

  const used = new Set();
  for (const advisory of atLevel) {
    const entry = valid.find((candidate) => candidate.id === advisory.id && candidate.package === advisory.package);
    if (entry) used.add(entry);
    else failures.push(`${advisory.severity} ${advisory.id} in ${advisory.package}: ${advisory.title}`);
  }
  return { failures, allowed: [...used], unused: valid.filter((entry) => !used.has(entry)) };
}

// Run as a command, also through a linked path: Node resolves links in its own URL, not in argv.
const invoked = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (invoked === realpathSync(fileURLToPath(import.meta.url))) {
  const here = dirname(fileURLToPath(import.meta.url));
  const [reportPath, level = 'high', allowlistPath = join(here, 'audit-allowlist.json')] = process.argv.slice(2);
  if (!reportPath || !(level in RANK)) {
    console.error('Usage: node scripts/ci/audit-gate.mjs <npm-audit.json> [info|low|moderate|high|critical] [allowlist.json]');
    process.exit(2);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (error) {
    report = { error: { message: String(error) } };
  }
  const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  const { failures, allowed, unused } = checkAudit(report, allowlist, new Date().toISOString().slice(0, 10), level);
  for (const entry of allowed) console.log(`Allowed until ${entry.expires}: ${entry.id} (${entry.package}). ${entry.reason}`);
  for (const entry of unused) console.log(`Unused allowlist entry, remove it: ${entry.id} (${entry.package})`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exit(1);
  }
  console.log(`No ${level} or worse advisories outside the allowlist.`);
}
