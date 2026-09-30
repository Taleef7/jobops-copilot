import assert from 'node:assert/strict';
import test from 'node:test';
import { planJobDedupe, type DedupeRow } from './job-dedupe';

// #346: the one-off cleanup of the duplicates discovery already inserted.
function row(id: string, overrides: Partial<DedupeRow> = {}): DedupeRow {
  return {
    id,
    jobUrl: null,
    company: 'ManTech',
    title: 'Software Engineer',
    location: 'Fort Meade',
    status: 'discovered',
    createdAt: `2026-09-2${id.length}T00:00:00.000Z`,
    notes: null,
    activity: 0,
    ...overrides,
  };
}

test('groups rows that share a canonical URL or company, title and location, and keeps the oldest', () => {
  const plan = planJobDedupe([
    row('a', { jobUrl: 'https://www.adzuna.com/land/ad/1?se=x', createdAt: '2026-09-20T00:00:00.000Z' }),
    row('b', { jobUrl: 'https://www.adzuna.com/details/1?utm_source=y', createdAt: '2026-09-21T00:00:00.000Z', location: 'Elsewhere' }),
    // Linked to b only by URL and to c only by fingerprint: one group, transitively.
    row('c', { jobUrl: 'https://www.adzuna.com/land/ad/2?se=z', createdAt: '2026-09-22T00:00:00.000Z', location: 'Elsewhere' }),
    row('d', { company: 'Jobot', jobUrl: 'https://www.adzuna.com/land/ad/3?se=z' }),
  ]);

  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0]?.keep, 'a');
  assert.deepEqual(plan.groups[0]?.remove, ['b', 'c']);
  assert.equal(plan.groups[0]?.skipped, undefined);
});

test('keeps the row the user worked on, so a passed job stays passed', () => {
  const plan = planJobDedupe([
    row('new', { jobUrl: 'https://www.adzuna.com/land/ad/7?se=new', createdAt: '2026-09-20T00:00:00.000Z' }),
    row('passed', { jobUrl: 'https://www.adzuna.com/land/ad/7?se=old', createdAt: '2026-09-25T00:00:00.000Z', status: 'archived', activity: 2 }),
  ]);

  assert.equal(plan.groups[0]?.keep, 'passed');
  assert.deepEqual(plan.groups[0]?.remove, ['new']);
});

test('notes count as work', () => {
  const plan = planJobDedupe([
    row('older', { createdAt: '2026-09-20T00:00:00.000Z' }),
    row('noted', { createdAt: '2026-09-25T00:00:00.000Z', notes: 'Recruiter called.' }),
  ]);

  assert.equal(plan.groups[0]?.keep, 'noted');
});

test('a group where more than one row has work is reported and left alone', () => {
  const plan = planJobDedupe([
    row('x', { status: 'applied' }),
    row('y', { activity: 1 }),
    row('z'),
  ]);

  assert.equal(plan.groups[0]?.skipped, 'more than one copy has your work on it');
  assert.deepEqual(plan.groups[0]?.remove, []);
  assert.deepEqual(plan.toDelete, []);
});

test('rows with no duplicates produce no groups', () => {
  const plan = planJobDedupe([row('a', { jobUrl: 'https://x.com/1' }), row('b', { company: 'Other', jobUrl: 'https://x.com/2' })]);

  assert.deepEqual(plan.groups, []);
  assert.deepEqual(plan.toDelete, []);
});
