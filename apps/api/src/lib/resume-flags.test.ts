import assert from 'node:assert/strict';
import test from 'node:test';
import { flagResume } from '@/lib/resume-flags';
import type { StructuredResume } from '@/types';

/**
 * #350: a parse that took a bullet's first word for an employer ("Encoded9") is flagged, so
 * the confirmation screen can hold it until the user fixes or confirms it.
 */

const role = (company: string, position: string, highlights: string[] = []) => ({
  company,
  position,
  startDate: '2026-05-01',
  highlights,
});

const resume = (work: StructuredResume['work']): StructuredResume => ({
  basics: { name: 'Jane Candidate', email: 'jane@example.com', summary: '' },
  work,
  education: [],
  skills: [],
});

test('a clean résumé has no flags', () => {
  assert.deepEqual(
    flagResume(
      resume([
        role('Medical Informatics Engineering', 'Software Developer', ['Encoded 9 regulatory measures']),
        role('Riccle (early-stage e-commerce startup)', 'Product Associate'),
        role('3M', 'Engineer'),
      ]),
    ),
    [],
  );
});

test('a company with a number stuck to a word is flagged', () => {
  const flags = flagResume(resume([role('Encoded9', 'Software Developer', ['Encoded 9 regulatory measures'])]));
  assert.equal(flags.length, 1);
  assert.equal(flags[0]!.path, 'work[0].company');
  assert.equal(flags[0]!.value, 'Encoded9');
  assert.match(flags[0]!.reason, /first word of a bullet|number stuck/);
});

test("a company that is the first word of one of the role's bullets is flagged", () => {
  const flags = flagResume(
    resume([
      role('Encoded', 'Software Developer', ['Encoded 9 regulatory measures as documented business rules']),
    ]),
  );
  assert.deepEqual(
    flags.map((flag) => [flag.path, flag.value]),
    [['work[0].company', 'Encoded']],
  );
  assert.match(flags[0]!.reason, /first word of a bullet/);
});

test('a bracket stuck to a word, and a missing company or title, are flagged', () => {
  const flags = flagResume(
    resume([role('Riccle(early-stage e-commerce startup)', 'Product Associate'), role('  ', '')]),
  );
  assert.deepEqual(
    flags.map((flag) => flag.path),
    ['work[0].company', 'work[1].company', 'work[1].position'],
  );
});
