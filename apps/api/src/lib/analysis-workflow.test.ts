import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANALYZED_NEXT_ACTION,
  deriveAnalyzedNextAction,
  UNSCORED_NEXT_ACTION,
} from './analysis-workflow';
import { OUTREACH_SENT_NEXT_ACTION } from './outreach-workflow';
import { PRERANK_MODEL } from './local-fit';

test('advances the creation-time prompt once a real scoring run lands', () => {
  assert.equal(deriveAnalyzedNextAction(UNSCORED_NEXT_ACTION, 'gpt-4o', 82), ANALYZED_NEXT_ACTION);
});

test('a zero score still counts as scored', () => {
  assert.equal(deriveAnalyzedNextAction(UNSCORED_NEXT_ACTION, 'gpt-4o', 0), ANALYZED_NEXT_ACTION);
});

test('tolerates surrounding whitespace on the stored prompt', () => {
  assert.equal(
    deriveAnalyzedNextAction(`  ${UNSCORED_NEXT_ACTION} `, 'gpt-4o', 70),
    ANALYZED_NEXT_ACTION,
  );
});

// saveJobAnalysis serves two very different routes. POST /ai/parse-job saves a
// parse with no score at all; POST /ai/score-fit saves one with a number. Only
// the second is a scoring run, and the model name cannot tell them apart — the
// parse path's `mock-analysis-v1` is also used for real agent parses and for
// the new-job placeholder.
test('does not advance on a parse with no fit score', () => {
  assert.equal(deriveAnalyzedNextAction(UNSCORED_NEXT_ACTION, 'mock-analysis-v1', undefined), null);
  assert.equal(deriveAnalyzedNextAction(UNSCORED_NEXT_ACTION, 'gpt-4o', null), null);
});

// Discovery's keyword estimate is explicitly not a scoring run (see
// local-fit.ts / migration 011). It can carry a number, so the model check has
// to exclude it independently of the score check above.
test('does not advance on a pre-rank estimate, even when it carries a score', () => {
  assert.equal(deriveAnalyzedNextAction(UNSCORED_NEXT_ACTION, PRERANK_MODEL, 100), null);
});

test('never overwrites a next action the user wrote', () => {
  assert.equal(deriveAnalyzedNextAction('Ping Dana about the referral', 'gpt-4o', 91), null);
});

// Re-scoring a role must not rewind the outreach workflow's prompt.
test('never rewinds a later workflow stage', () => {
  assert.equal(deriveAnalyzedNextAction(OUTREACH_SENT_NEXT_ACTION, 'gpt-4o', 91), null);
});

test('leaves an absent next action alone', () => {
  assert.equal(deriveAnalyzedNextAction(null, 'gpt-4o', 60), null);
  assert.equal(deriveAnalyzedNextAction(undefined, 'gpt-4o', 60), null);
  assert.equal(deriveAnalyzedNextAction('', 'gpt-4o', 60), null);
});
