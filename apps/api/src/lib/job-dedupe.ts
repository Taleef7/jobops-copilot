/**
 * Plan the one-off cleanup of duplicate jobs discovery already inserted (#346).
 *
 * Rows are the same job when they share a canonical URL or a company|title|location
 * fingerprint, transitively (a job re-listed under a new ad id links to its earlier copy
 * through the fingerprint). In each group the row the user worked on is kept (a status
 * beyond "discovered", notes, outreach, contacts, résumé versions, agent outputs), then one
 * with a fit score, else the oldest. A group where more than one row has work is left alone: deleting a copy would
 * cascade away that work, so it is reported for the user to merge by hand.
 */
import { applyJobDedupe, listUsersWithJobs, loadDedupeRows } from '@/data/job-dedupe.postgres';
import { canonicalJobUrl, fingerprintKey } from '@/lib/job-sources/normalize';

export interface DedupeRow {
  id: string;
  jobUrl: string | null;
  company: string;
  title: string;
  location: string | null;
  status: string;
  createdAt: string;
  notes: string | null;
  /** Outreach, contacts, résumé versions and agent outputs attached to the row. */
  activity: number;
  /** It has a fit score from a model, not only the local pre-rank every discovered job gets. */
  scored: boolean;
}

export interface DedupeGroup {
  keep: string;
  remove: string[];
  size: number;
  label: string;
  /** Why the group is left alone, when it is. */
  skipped?: string;
}

export interface DedupePlan {
  groups: DedupeGroup[];
  toDelete: string[];
}

function hasWork(row: DedupeRow): boolean {
  return row.status !== 'discovered' || Boolean(row.notes?.trim()) || row.activity > 0;
}

export function planJobDedupe(rows: DedupeRow[]): DedupePlan {
  // Union-find over the rows, joined by every key they occupy.
  const parent = rows.map((_, index) => index);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const firstByKey = new Map<string, number>();
  rows.forEach((row, index) => {
    const keys = [fingerprintKey({ company: row.company, title: row.title, location: row.location ?? '' })];
    if (row.jobUrl) keys.push(canonicalJobUrl(row.jobUrl));
    for (const key of keys) {
      const first = firstByKey.get(key);
      if (first === undefined) firstByKey.set(key, index);
      else parent[find(index)] = find(first);
    }
  });

  const members = new Map<number, DedupeRow[]>();
  rows.forEach((row, index) => {
    const root = find(index);
    members.set(root, [...(members.get(root) ?? []), row]);
  });

  const groups: DedupeGroup[] = [];
  for (const group of members.values()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort(
      (a, b) =>
        Number(hasWork(b)) - Number(hasWork(a)) ||
        b.activity - a.activity ||
        Number(b.scored) - Number(a.scored) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
    const keep = ranked[0]!;
    const label = `${keep.company} · ${keep.title}${keep.location ? ` · ${keep.location}` : ''}`;
    if (group.filter(hasWork).length > 1) {
      groups.push({ keep: keep.id, remove: [], size: group.length, label, skipped: 'more than one copy has your work on it' });
      continue;
    }
    groups.push({ keep: keep.id, remove: ranked.slice(1).map((row) => row.id), size: group.length, label });
  }

  groups.sort((a, b) => b.size - a.size || a.label.localeCompare(b.label));
  return { groups, toDelete: groups.flatMap((group) => group.remove) };
}

/**
 * `scripts/dedupe-jobs.ts [--user <id>] [--apply]`. A dry run by default: it prints each
 * user's groups and the ids it would delete. `--apply` needs `--user`, so an account is
 * only ever cleaned when it is named.
 */
export async function dedupeJobs(argv: string[], log: (line: string) => void = console.log): Promise<void> {
  const apply = argv.includes('--apply');
  const userFlag = argv.indexOf('--user');
  const onlyUser = userFlag >= 0 ? argv[userFlag + 1] : undefined;
  if (userFlag >= 0 && !onlyUser) throw new Error('--user needs a user id.');
  if (apply && !onlyUser) throw new Error('--apply needs --user <id>: name the account to clean.');

  const users = onlyUser ? [onlyUser] : await listUsersWithJobs();
  log(apply ? `Applying to ${onlyUser}.` : 'Dry run: nothing is deleted. Add --apply --user <id> to clean an account.');

  for (const userId of users) {
    const rows = await loadDedupeRows(userId);
    const plan = planJobDedupe(rows);
    const skipped = plan.groups.filter((group) => group.skipped).length;
    const groupWord = plan.groups.length === 1 ? 'group' : 'groups';
    log(`${userId}: ${rows.length} jobs, ${plan.groups.length} ${groupWord}, ${plan.toDelete.length} to delete${skipped ? `, ${skipped} left alone` : ''}`);
    for (const group of plan.groups) {
      log(`  ${group.size}× ${group.label}: keep ${group.keep}${group.skipped ? ` (left alone: ${group.skipped})` : ''}`);
      for (const id of group.remove) log(`      delete ${id}`);
    }
    if (apply && plan.toDelete.length > 0) {
      const result = await applyJobDedupe(userId, plan);
      log(`  Deleted ${result.deleted} job(s); moved ${result.notificationsMoved} notification(s) to the kept job.`);
    }
  }
}
