import assert from 'node:assert/strict';
import test from 'node:test';
import { MIN_EVIDENCE_SKILLS, PRERANK_MODEL, computeLocalFit, prerankAnalysis } from './local-fit';

test('scores the overlap of resume skills against job skills', () => {
  // Description mentions TypeScript, React, Node.js (3 catalog skills = the
  // evidence floor). Resume covers TypeScript + React (2 of 3) → round(2/3*100) = 67.
  const description = 'We use TypeScript, React, and Node.js daily.';
  const resume = 'Senior engineer fluent in TypeScript and React.';

  const { score, matchedSkills } = computeLocalFit(description, resume);

  assert.equal(score, 67);
  assert.deepEqual(matchedSkills.sort(), ['React', 'TypeScript']);
});

test('scores 100 when the resume covers every job skill', () => {
  const result = computeLocalFit(
    'TypeScript, React, and Node.js.',
    'TypeScript, React, Node.js, and more.',
  );
  assert.equal(result.score, 100);
});

test('scores 0 when a well-described job shares nothing with the resume', () => {
  // Enough skills to divide by, genuinely no overlap → 0 is a real verdict here.
  const result = computeLocalFit('We use Python, SQL, and n8n.', 'TypeScript React');
  assert.equal(result.score, 0);
  assert.deepEqual(result.matchedSkills, []);
});

test('returns null (not 0) with no resume to compare against', () => {
  const result = computeLocalFit('We use TypeScript, React, and Node.js.', '   ');
  assert.equal(result.score, null);
  assert.deepEqual(result.matchedSkills, []);
});

test('returns null when the description has no recognised skills', () => {
  // "unknown", not "terrible match" — 0 would render as a scored red ring.
  const result = computeLocalFit('A friendly team that loves coffee.', 'TypeScript React');
  assert.equal(result.score, null);
});

test('returns null below the evidence floor, even on a full match', () => {
  // One recognised skill can only yield 0 or 100. A lone keyword hit must not
  // publish "100" — this is the shape job-board snippets actually arrive in.
  const result = computeLocalFit('Experience with TypeScript required.', 'I know TypeScript.');
  assert.equal(result.score, null);
  // The observation itself is still reported; only the verdict is withheld.
  assert.deepEqual(result.matchedSkills, ['TypeScript']);
});

test('the evidence floor is the documented minimum', () => {
  assert.equal(MIN_EVIDENCE_SKILLS, 3);
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
  // A matched skill must never also appear as missing.
  const overlap = analysis.missingSkills.filter((skill) => analysis.matchedSkills.includes(skill));
  assert.deepEqual(overlap, []);
});

test('prerankAnalysis leaves the score unset when evidence is thin', () => {
  const { fitScore, analysis } = prerankAnalysis(
    'Experience with TypeScript required.',
    'I know TypeScript.',
  );

  assert.equal(fitScore, null);
  // Still a usable analysis — just without a fabricated number attached.
  assert.equal(analysis.modelUsed, PRERANK_MODEL);
  assert.deepEqual(analysis.matchedSkills, ['TypeScript']);
});

test('realistic 1500-char JD mentioning Python, PostgreSQL, Docker, Kubernetes, Terraform clears evidence floor', () => {
  const intro = 'We are seeking an experienced Platform Engineer to scale our infrastructure. ';
  const requirements = 'Key technologies required: Python, PostgreSQL, Docker, Kubernetes, Terraform. ';
  const details = 'You will be responsible for building reliable deployment pipelines, designing robust backend services, monitoring cluster health, collaborating with product engineers, conducting architecture reviews, optimizing database queries, and participating in on-call rotations. We value clean code, strong testing practices, and clear documentation across all engineering workflows. '.repeat(4);
  const fullJd = (intro + requirements + details).slice(0, 1500);

  assert.equal(fullJd.length, 1500);

  // Resume contains three of them: Docker, Kubernetes, Terraform
  const resume = 'Experienced Platform Engineer skilled in Docker containerization, Kubernetes orchestration, and Terraform infrastructure.';

  const { score, matchedSkills } = computeLocalFit(fullJd, resume);

  assert.notEqual(score, null);
  assert.equal(typeof score, 'number');
  assert.equal(score, 50); // 3 of 6 (Python, PostgreSQL, SQL, Docker, Kubernetes, Terraform) = 50%
  assert.deepEqual(matchedSkills.sort(), ['Docker', 'Kubernetes', 'Terraform']);
});
