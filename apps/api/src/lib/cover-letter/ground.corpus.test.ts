import assert from 'node:assert/strict';
import test from 'node:test';
import { REVIEW_HONEST, REVIEW_INVENTED, REVIEW_LINKS, SRE_BASE, SRE_JOB, SRE_TERMS } from '@/test-support/letter-fixtures';
import { groundLetter, type LetterContext } from './ground';

/**
 * The third review's corpus (#416), by class. The owner's rule: what the check can prove is
 * dropped (numbers, dates, links, credentials, posting skills, placeholders); what it can only
 * guess (names, ties, employers, languages, titles, leadership) is flagged for the user to keep
 * or remove before the letter prints. Nothing invented is kept unmarked.
 */

const ctx = (overrides: Partial<LetterContext> = {}): LetterContext => ({
  base: SRE_BASE,
  job: SRE_JOB,
  jobTerms: SRE_TERMS,
  confirmedKeywords: [],
  ...overrides,
});

type Finding = 'drop' | 'flag' | 'kept';

function findingOf(sentence: string): Finding {
  const result = groundLetter([sentence], ctx());
  if (result.paragraphs.length === 0) return 'drop';
  return result.checks.some((check) => check.severity === 'flag') ? 'flag' : 'kept';
}

/** What the check can prove: these are always dropped. */
const PROVABLE = [
  'Over three years at Initech, I kept Kubernetes healthy.',
  'I cut our cloud spend by half with Terraform cleanups.',
  'I reduced alert noise by forty percent with Prometheus.',
  'I mentored a dozen interns through their first on-call shifts.',
  'I ran the on-call rotation for fifty engineers.',
  'I trained hundreds of engineers on Terraform.',
  'I won our internal hackathon twice.',
  'I passed the CKAD exam on my first attempt.',
  'I scaled the Kubernetes fleet tenfold in a single quarter.',
  'I personally handled over a thousand incidents.',
  'I hold the Kubernetes Administrator credential.',
  'I scaled the platform fivefold.',
  'I cut costs threefold with Terraform.',
];

test('every invented claim is dropped or flagged, never kept unmarked', () => {
  const unmarked = REVIEW_INVENTED.filter((sentence) => findingOf(sentence) === 'kept');
  assert.deepEqual(unmarked, []);
});

test('what the check can prove is dropped', () => {
  const notDropped = PROVABLE.filter((sentence) => findingOf(sentence) !== 'drop');
  assert.deepEqual(notDropped, []);
});

test('no honest sentence is dropped, and few are flagged', () => {
  const findings = REVIEW_HONEST.map((sentence) => [sentence, findingOf(sentence)] as const);
  assert.deepEqual(
    findings.filter(([, finding]) => finding === 'drop').map(([sentence]) => sentence),
    [],
  );
  // A flag costs a click: at most one in eight honest sentences.
  const flagged = findings.filter(([, finding]) => finding === 'flag').map(([sentence]) => sentence);
  assert.ok(flagged.length <= REVIEW_HONEST.length / 8, `${flagged.length} flagged: ${JSON.stringify(flagged, null, 1)}`);
});

test('"doubled down" is not a number', () => {
  assert.equal(findingOf('I doubled down on runbooks after a rough on-call week.'), 'kept');
});

test("links and addresses fail closed: only the candidate's own address is kept, in any case", () => {
  const own = 'You can reach me at Priya.Raman@Example.com any time.';
  for (const sentence of REVIEW_LINKS) {
    assert.equal(findingOf(sentence), sentence === own ? 'kept' : 'drop', sentence);
  }
});

test('a flag is kept in the letter, marked, and says why', () => {
  const sentence = 'I joined initech straight out of college.';
  const result = groundLetter([sentence], ctx());
  assert.deepEqual(result.paragraphs, [sentence]);
  const [check] = result.checks;
  assert.equal(check!.severity, 'flag');
  assert.equal(check!.dropped, false);
  assert.ok(check!.id, 'a flag has an id the review can resolve it by');
  assert.equal(check!.resolution, undefined);
  assert.ok(check!.issues.every((issue) => issue.severity === 'flag'));
});
