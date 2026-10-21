import assert from 'node:assert/strict';
import test from 'node:test';
import { REVIEW_HONEST, REVIEW_INVENTED, REVIEW_LINKS, SRE_BASE, SRE_JOB, SRE_TERMS } from '@/test-support/letter-fixtures';
import { groundLetter, settledParagraphs, type LetterContext } from './ground';

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

// Fourth review (#416).

test('experience near the company is read by word distance, in linear time', () => {
  for (const sentence of ["Fabrikam's platform team was my client.", 'I know the team at Fabrikam well.']) {
    assert.equal(findingOf(sentence), 'flag', sentence);
  }
  // The trade-off: more than six words between them, and the tie isn't read.
  assert.equal(findingOf('I know, from years of reading about it and talking with friends there, Fabrikam well.'), 'kept');
  const unit = `know ${"a'".repeat(60)} `;
  groundLetter(['I build things.'], ctx()); // The first call builds the check's patterns: not timed.
  for (const text of [`I ${unit}`, `I ${unit.repeat(5)}`.slice(0, 3_000)]) {
    const started = performance.now();
    groundLetter([text], ctx());
    const ms = performance.now() - started;
    assert.ok(ms < 200, `${text.length} chars: ${ms.toFixed(0)} ms`);
  }
});

test('a flagged sentence is settled by its place in the paragraph, not by substring', () => {
  // Also a substring of the sentence before it, quoted: removing by substring would cut that one.
  const result = groundLetter(['I would never write "Fabrikam was my client." in a letter to you. Fabrikam was my client.'], ctx());
  const flag = result.checks.find((check) => check.severity === 'flag')!;
  assert.equal(flag.text, 'Fabrikam was my client.');
  assert.equal(flag.sentence, 1);
  const letter = { paragraphs: result.paragraphs.map((text) => ({ text, edited: false })), checks: result.checks };
  assert.deepEqual(settledParagraphs(letter), ['I would never write "Fabrikam was my client." in a letter to you.']);
  // The reviewer's case: the same sentence twice, the first time inside a longer one.
  const twice = groundLetter(['I could say Fabrikam was my client. Fabrikam was my client.'], ctx());
  assert.deepEqual(
    twice.checks.map((check) => [check.severity, check.sentence]),
    [['flag', 1]],
  );
});

test('an exam is a credential only when passed or sat, and "examined" in the résumé is no evidence', () => {
  const base = structuredClone(SRE_BASE);
  base.work[0]!.highlights = [...base.work[0]!.highlights, 'Examined incident timelines in every postmortem'];
  const withExamined = (sentence: string) => groundLetter([sentence], ctx({ base }));
  assert.deepEqual(withExamined('I passed the bar exam.').paragraphs, []);
  const honest = 'I treat every postmortem like an exam.';
  assert.deepEqual(withExamined(honest).paragraphs, [honest]);
  assert.equal(findingOf(honest), 'kept');
});

test('"-fold" is a number only as a quantity', () => {
  assert.equal(findingOf('I see a twofold opportunity in this role.'), 'kept');
  assert.equal(findingOf('The pages I got grew threefold before I rebuilt the alerting.'), 'drop');
  assert.equal(findingOf('I delivered a fivefold increase in deploy speed.'), 'drop');
});
