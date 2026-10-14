import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTailorRequest, MAX_FACTS_LENGTH, MAX_LINE_LENGTH, MAX_LINES_LENGTH } from './request';
import { TAILOR_BASE } from '@/test-support/tailor-fixtures';
import type { JobRecord, StructuredResume } from '@/types';

const job = { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs.', analysis: null } as unknown as JobRecord;

test('a résumé of the usual size is sent whole', () => {
  const request = buildTailorRequest(TAILOR_BASE, job, []);
  assert.equal(request.lines.length, 10);
  assert.deepEqual(request.skills, ['Go', 'Python', 'SQL', 'PostgreSQL', 'Docker']);
});

test('a very large résumé is cut to the LLM input limits before it reaches the agent', () => {
  const huge: StructuredResume = {
    ...TAILOR_BASE,
    basics: { ...TAILOR_BASE.basics, summary: 'Backend engineer. '.repeat(20) },
    work: Array.from({ length: 200 }, (_v, i) => ({
      company: `Company ${i}`,
      position: 'Engineer',
      startDate: '2020-01',
      summary: 'x'.repeat(5_000),
      highlights: [`Built service ${i} in Go`, 'y'.repeat(MAX_LINE_LENGTH + 1), ...Array.from({ length: 20 }, (_w, j) => `Shipped feature ${j} for team ${i}`)],
    })),
    skills: [{ category: 'Languages', skills: Array.from({ length: 5_000 }, (_v, i) => `Skill ${i}`) }],
  };
  const request = buildTailorRequest(huge, job, []);
  const linesLength = request.lines.reduce((sum, line) => sum + line.text.length, 0);
  assert.ok(linesLength <= MAX_LINES_LENGTH, `lines ${linesLength}`);
  assert.ok(request.lines.every((line) => line.text.length <= MAX_LINE_LENGTH), 'no overlong line is offered');
  assert.equal(request.lines[0]!.path, 'basics.summary', 'the summary comes first');
  assert.ok(request.facts.length <= MAX_FACTS_LENGTH, `facts ${request.facts.length}`);
  assert.ok(request.skills.length <= 200, `skills ${request.skills.length}`);
  // Lines are sent whole or not at all: an edit's old text must match the résumé.
  for (const line of request.lines) assert.ok(!line.text.endsWith('…'));
});

test('cutting the facts never splits a character in two', () => {
  const emoji: StructuredResume = {
    ...TAILOR_BASE,
    work: [{ ...TAILOR_BASE.work[0]!, summary: '\u{1F600}'.repeat(20_000) }],
  };
  const { facts } = buildTailorRequest(emoji, job, []);
  assert.doesNotMatch(facts, /\p{Cs}/u);
});

test('the number of lines and the length of each skill are bounded too', () => {
  const many: StructuredResume = {
    ...TAILOR_BASE,
    work: Array.from({ length: 1_000 }, (_v, i) => ({ ...TAILOR_BASE.work[0]!, company: `C${i}`, highlights: Array.from({ length: 15 }, () => 'x') })),
    skills: [{ category: 'Long', skills: Array.from({ length: 300 }, () => 'y'.repeat(10_000)) }],
  };
  const request = buildTailorRequest(many, job, []);
  assert.ok(JSON.stringify(request).length < 120_000, `request ${JSON.stringify(request).length}`);
});
