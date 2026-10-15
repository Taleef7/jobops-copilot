import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPENERS,
  SRE_BASE,
  SRE_HONEST,
  SRE_INVENTED,
  SRE_JOB,
  SRE_LETTER,
  SRE_TERMS,
} from '@/test-support/letter-fixtures';
import { MAX_LETTER_CHARS, MAX_PARAGRAPH_CHARS, TARGET_WORDS } from './limits';
import { groundLetter, type LetterContext } from './ground';

/**
 * The final review's probes (#416), kept as regressions: the check must keep what an honest
 * letter says (it dropped 13 of 24 honest sentences and 37 of 51 ordinary openers) and still
 * drop every invented claim.
 */

const ctx = (overrides: Partial<LetterContext> = {}): LetterContext => ({
  base: SRE_BASE,
  job: SRE_JOB,
  jobTerms: SRE_TERMS,
  confirmedKeywords: [],
  ...overrides,
});
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

test('every honest sentence is kept', () => {
  const dropped = SRE_HONEST.filter((sentence) => groundLetter([sentence], ctx()).paragraphs.length === 0);
  assert.deepEqual(dropped, []);
});

test("a posting skill the résumé lacks stays dropped, even phrased as practice", () => {
  // The reviewer's honest list had this one; it claims "incident response", a posting skill the
  // résumé never names (it says postmortems and runbooks). The check keeps dropping it.
  const result = groundLetter(['Calm incident response is something I practice by running blameless postmortems.'], ctx());
  assert.deepEqual(result.paragraphs, []);
  assert.equal(result.checks[0]!.issues[0]!.code, 'NEW_SKILL');
});

test('an honest Concise letter passes whole', () => {
  const result = groundLetter(SRE_LETTER, ctx());
  assert.deepEqual(
    result.checks.filter((check) => check.dropped).map((check) => `${check.text} -> ${check.dropReason}`),
    [],
  );
  const kept = result.paragraphs.reduce((sum, paragraph) => sum + words(paragraph), 0);
  assert.equal(kept, SRE_LETTER.reduce((sum, paragraph) => sum + words(paragraph), 0));
  assert.ok(kept >= TARGET_WORDS.concise.min);
});

test('an ordinary word opening a sentence is not a name', () => {
  const dropped = OPENERS.filter(
    (word) => groundLetter([`${word} is something I think about whenever I run Kubernetes on AWS.`], ctx()).paragraphs.length === 0,
  );
  assert.deepEqual(dropped, []);
});

test('every invented claim is dropped', () => {
  const kept = SRE_INVENTED.filter((sentence) => groundLetter([sentence], ctx()).paragraphs.length > 0);
  assert.deepEqual(kept, []);
});

test('sign-offs in the shapes models write are left out, and only they', () => {
  const body = 'I migrated 40 services to Kubernetes on AWS EKS with Terraform.';
  const cases: Array<[string[], string[]]> = [
    [[`${body}\n\nSincerely,\nPriya Raman, Site Reliability Engineer`], [body]],
    [[`${body}\n\nBest regards,\nPriya Raman\npriya.raman@example.com`], [body]],
    [[`${body}\n\nSincerely,\nPriya van Raman`], [body]],
    [[body, 'Thank you for your time and consideration.', 'Sincerely,', 'Priya Raman'], [body, 'Thank you for your time and consideration.']],
    [[body, 'Thank you!', body, 'Best,', 'Priya Raman'], [body, 'Thank you!', body]],
    [[`${body}\n\nWarmly,\nPriya Raman`], [body]],
    [[`${body}\n\nAll the best,\nPriya Raman`], [body]],
    [[`${body}\n\nbest regards,\npriya raman`], [body]],
    [[`${body}\n\nThanks again,\nPriya`], [body]],
    [[`${body}\nThank you for your consideration.\nSincerely,\nPriya Raman`], [`${body} Thank you for your consideration.`]],
  ];
  for (const [raw, expected] of cases) assert.deepEqual(groundLetter(raw, ctx()).paragraphs, expected, JSON.stringify(raw));
});

test('a link or an address is compared whole, and any domain counts', () => {
  for (const sentence of [
    'You can see my Kubernetes work at GitHub.com/priya-evil.',
    'My portfolio is at priyaraman.net.',
    'You can reach me at raman@example.com.',
    'You can also find me at linkedin.com/in/someoneelse.',
    'Reach me at priya(at)evil.example.',
  ]) {
    assert.deepEqual(groundLetter([sentence], ctx()).paragraphs, [], sentence);
  }
  const own = 'You can reach me at priya.raman@example.com.';
  assert.deepEqual(groundLetter([own], ctx()).paragraphs, [own]);
  const tools = 'I keep Node.js and ASP.NET services healthy too.';
  assert.deepEqual(groundLetter([tools], ctx({ confirmedKeywords: ['Node.js', 'ASP.NET'] })).paragraphs, [tools]);
});

test('hostile text at the size the route lets through is checked quickly', () => {
  const size = 2 * MAX_PARAGRAPH_CHARS;
  const total = 3 * MAX_LETTER_CHARS;
  const inputs = {
    bracket: '['.repeat(size),
    brace: '{'.repeat(size),
    letters: 'a'.repeat(size),
    dotted: 'a.'.repeat(size / 2),
    hyphen: 'a-'.repeat(size / 2),
    digitsdot: '1.'.repeat(size / 2),
    atsigns: 'a@a'.repeat(size / 3),
  };
  for (const [name, text] of Object.entries(inputs)) {
    const paragraphs = Array.from({ length: Math.floor(total / size) }, () => text);
    const started = performance.now();
    groundLetter(paragraphs, ctx());
    const ms = performance.now() - started;
    assert.ok(ms < 1_500, `${name}: ${ms.toFixed(0)} ms`);
  }
});
