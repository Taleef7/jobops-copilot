import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANALYZED_NEXT_ACTION,
  deriveAnalyzedNextAction,
  UNSCORED_NEXT_ACTION,
} from './analysis-workflow';
import { OUTREACH_SENT_NEXT_ACTION } from './outreach-workflow';
import { PRERANK_MODEL } from './local-fit';

test('advances the creation-time prompt once a real analysis lands', () => {
  assert.equal(deriveAnalyzedNextAction(UNSCORED_NEXT_ACTION, 'gpt-4o'), ANALYZED_NEXT_ACTION);
});

test('tolerates surrounding whitespace on the stored prompt', () => {
  assert.equal(deriveAnalyzedNextAction(`  ${UNSCORED_NEXT_ACTION} `, 'gpt-4o'), ANALYZED_NEXT_ACTION);
});

// Discovery's keyword estimate is explicitly not a scoring run (see
// local-fit.ts / migration 011), so the prompt to actually score has to
// survive it — otherwise every discovered job would look already handled.
test('does not advance on a pre-rank estimate', () => {
  assert.equal(deriveAnalyzedNextAction(UNSCORED_NEXT_ACTION, PRERANK_MODEL), null);
});

test('never overwrites a next action the user wrote', () => {
  assert.equal(deriveAnalyzedNextAction('Ping Dana about the referral', 'gpt-4o'), null);
});

// Re-scoring a role must not rewind the outreach workflow's prompt.
test('never rewinds a later workflow stage', () => {
  assert.equal(deriveAnalyzedNextAction(OUTREACH_SENT_NEXT_ACTION, 'gpt-4o'), null);
});

test('leaves an absent next action alone', () => {
  assert.equal(deriveAnalyzedNextAction(null, 'gpt-4o'), null);
  assert.equal(deriveAnalyzedNextAction(undefined, 'gpt-4o'), null);
  assert.equal(deriveAnalyzedNextAction('', 'gpt-4o'), null);
});
