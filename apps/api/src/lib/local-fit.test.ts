import assert from 'node:assert/strict';
import test from 'node:test';
import { PRERANK_MODEL, computeLocalFit, prerankAnalysis } from './local-fit';

test('scores the overlap of resume skills against job skills', () => {
  // Description mentions TypeScript, React, Node.js (3 catalog skills).
  // Resume covers TypeScript + React (2 of 3) → round(2/3*100) = 67.
  const description = 'We use TypeScript, React, and Node.js daily.';
  const resume = 'Senior engineer fluent in TypeScript and React.';

  const { score, matchedSkills } = computeLocalFit(description, resume);

  assert.equal(score, 67);
  assert.deepEqual(matchedSkills.sort(), ['React', 'TypeScript']);
});

test('returns 0 with no resume', () => {
  const result = computeLocalFit('We use TypeScript and React.', '');
  assert.equal(result.score, 0);
  assert.deepEqual(result.matchedSkills, []);
});

test('returns 0 when the description has no recognised skills', () => {
  const result = computeLocalFit('A friendly team that loves coffee.', 'TypeScript React');
  assert.equal(result.score, 0);
  assert.deepEqual(result.matchedSkills, []);
});

test('scores 100 when the resume covers every job skill', () => {
  const result = computeLocalFit('TypeScript and React.', 'TypeScript, React, and more.');
  assert.equal(result.score, 100);
});

test('prerankAnalysis builds an estimated analysis tagged local-prerank', () => {
  const { fitScore, analysis } = prerankAnalysis(
    'We use TypeScript, React, and Node.js daily.',
    'Senior engineer fluent in TypeScript and React.',
  );

  // Carries the local-fit score …
  assert.equal(fitScore, 67);
  // … the matched skills from the overlap …
  assert.deepEqual(analysis.matchedSkills.sort(), ['React', 'TypeScript']);
  // … parsed required/preferred skills from the description …
  assert.ok(analysis.requiredSkills.length > 0);
  // … and the sentinel that marks it estimated (so the UI can upgrade on open).
  assert.equal(analysis.modelUsed, PRERANK_MODEL);
  assert.equal(PRERANK_MODEL, 'local-prerank');
});
