import assert from 'node:assert/strict';
import test from 'node:test';
import { tailorFromAnswer } from './apply';
import { TAILOR_BASE, TAILOR_JOB, edit, emptyAnswer } from '@/test-support/tailor-fixtures';
import type { StructuredResume } from '@/types';

/**
 * Cases from the adversarial review of the grounding check (#351): ways a model could add a
 * fact that must be dropped, and honest rewrites that must be kept.
 */

function outcome(
  path: string,
  newText: string,
  options: { base?: StructuredResume; confirmed?: string[]; jobTerms?: string[]; company?: string } = {},
) {
  const base = options.base ?? TAILOR_BASE;
  const result = tailorFromAnswer(base, emptyAnswer({ edits: [edit(path, newText, lineOf(base, path))] }), {
    company: options.company ?? TAILOR_JOB.company,
    jobTerms: options.jobTerms ?? TAILOR_JOB.jobTerms,
    confirmedKeywords: options.confirmed ?? [],
  });
  const detail = result.details.find((d) => d.kind === 'rewrite');
  assert.ok(detail, `a detail for ${newText}`);
  return detail;
}

function lineOf(base: StructuredResume, path: string): string {
  if (path === 'basics.summary') return base.basics.summary;
  const [, role, bullet] = /^work\[(\d+)\]\.highlights\[(\d+)\]$/.exec(path)!;
  return base.work[Number(role)]!.highlights[Number(bullet)]!;
}

function dropped(path: string, newText: string, options: Parameters<typeof outcome>[2] = {}) {
  const detail = outcome(path, newText, options);
  assert.equal(detail.dropped, true, `should be dropped: ${JSON.stringify(newText)}`);
}

function kept(path: string, newText: string, options: Parameters<typeof outcome>[2] = {}) {
  const detail = outcome(path, newText, options);
  assert.equal(detail.dropped, false, `should be kept: ${JSON.stringify(newText)} (${JSON.stringify(detail.issues)})`);
}

const withBullet = (role: number, bullet: number, text: string): StructuredResume => {
  const base = structuredClone(TAILOR_BASE);
  base.work[role]!.highlights[bullet] = text;
  return base;
};

test('a number from elsewhere, or with a new unit, is not evidence', () => {
  // "10 hours", "12–15 min" and "3 services" are in the résumé; years of experience are not.
  dropped('basics.summary', 'Backend engineer with 10 years of experience who builds payment APIs in Go.');
  dropped('basics.summary', 'Backend engineer with 15 years of experience who builds payment APIs in Go.');
  dropped('basics.summary', 'Backend engineer with 3+ years of experience who builds payment APIs in Go.');
  dropped('work[0].highlights[1]', 'Reduced p95 latency to 40 ms with Redis caching');
  // One "2,000" can't support two claims.
  dropped('work[0].highlights[0]', 'Built the billing API in Go handling 2,000 requests per second for 2,000 merchants');
});

test('numbers written as words, multipliers or glued to text are read', () => {
  dropped('work[0].highlights[0]', 'Built the billing API in Go serving a million merchants');
  dropped('work[0].highlights[0]', 'Built the billing API in Go serving millions of merchants');
  dropped('work[0].highlights[1]', 'Doubled throughput and reduced p95 latency by 40% with Redis caching');
  dropped('work[0].highlights[1]', 'Reduced p95 latency x3 with Redis caching');
  dropped('work[0].highlights[1]', 'Reduced p95 latency by60% with Redis caching');
  dropped('work[0].highlights[1]', 'Reduced p95 latency by \u0666\u0660% with Redis caching');
  dropped('work[0].highlights[1]', 'Reduced p95 latency by 4\u20604% with Redis caching');
  kept('work[0].highlights[0]', 'Built the billing API in Go serving two thousand merchants');
  kept('work[0].highlights[0]', 'Built the billing API in Go serving thousands of merchants');
  kept('work[0].highlights[1]', 'Reduced 95th-percentile latency by 40% with Redis caching');
});

test('a confirmed keyword is not evidence for its digits', () => {
  dropped('work[0].highlights[2]', 'Mentored 18 interns', { confirmed: ['React 18'] });
  dropped('basics.summary', 'Backend engineer who builds payment APIs in Go, since 2023.', {
    confirmed: ['AWS Certified Developer 2023'],
  });
  kept('work[0].highlights[0]', 'Built the billing API in Go and React 18 serving 2,000 merchants', { confirmed: ['React 18'] });
});

test('tools are found however they are written', () => {
  for (const text of [
    'Built the billing API in Go on a Rust-based core serving 2,000 merchants',
    'Built the billing API in Go and RUST serving 2,000 merchants',
    "Built the billing API in Go and Rust's tooling serving 2,000 merchants",
    'Built the billing API in Go and Kaf\u00adka serving 2,000 merchants',
    'Built the billing API in Go and K\u0430fka serving 2,000 merchants',
    'Built the billing API in Go and ClickHouse serving 2,000 merchants',
    'Built the billing API in Go with Memcached serving 2,000 merchants',
  ]) {
    dropped('work[0].highlights[0]', text);
  }
});

test('a line that adds more than it rewords is dropped', () => {
  dropped(
    'work[0].highlights[2]',
    'Mentored two interns while architecting the event-driven settlement platform and fraud detection system',
  );
});

test('another employer, or a title the résumé never held, is dropped', () => {
  dropped('basics.summary', 'Backend engineer at Acme who builds payment APIs in Go.');
  dropped('basics.summary', 'Backend engineer who builds AcmePay payment APIs in Go.');
  dropped('basics.summary', 'Ex-Google backend engineer who builds payment APIs in Go.');
  dropped('basics.summary', 'Backend engineer who builds payment APIs in Go.\n\nEXPERIENCE\nHooli, Platform Engineer');
  dropped('basics.summary', 'Backend tech lead who builds payment APIs in Go.');
  dropped('basics.summary', 'Engineering manager who builds payment APIs in Go.');
  dropped('basics.summary', 'Senior-level backend engineer who builds payment APIs in Go.');
  dropped('basics.summary', 'Senior Go payments platform engineer who builds payment APIs in Go.');
  dropped('work[0].highlights[4]', 'Presented the migration plan to leadership as the senior engineer');
  // "senior leadership" in a bullet is not a senior title.
  const senior = withBullet(0, 4, 'Presented the migration plan to senior leadership');
  dropped('basics.summary', 'Senior backend engineer who builds payment APIs in Go.', { base: senior });
  kept('work[0].highlights[3]', 'Partnered with sales and senior engineers on the go-to-market launch');
});

test('degrees are read in their usual spellings, both ways', () => {
  dropped('basics.summary', 'Backend engineer with a Master of Science who builds payment APIs in Go.');
  dropped('basics.summary', 'Backend engineer with an MS in Computer Science who builds payment APIs in Go.');
  dropped('basics.summary', 'Backend engineer with an MEng who builds payment APIs in Go.');
  kept('basics.summary', 'Backend engineer with a B.S. in Computer Science who builds payment APIs in Go.');
  const spelledOut: StructuredResume = {
    ...TAILOR_BASE,
    education: [{ institution: 'University of London', studyType: 'Bachelor of Science', area: 'Computer Science' }],
  };
  kept('basics.summary', "Backend engineer with a bachelor's in Computer Science who builds payment APIs in Go.", {
    base: spelledOut,
  });
});

test('honest rewrites the first version dropped are kept', () => {
  kept('basics.summary', 'Backend engineer who builds payments APIs in Go.', { jobTerms: ['payments'] });
  kept('work[0].highlights[2]', 'Coached two interns');
  const aws = withBullet(1, 1, 'Migrated 3 services to EC2 and S3');
  kept('work[1].highlights[1]', 'Migrated 3 services to AWS (EC2 and S3)', { base: aws });
  const lower = withBullet(1, 0, 'Automated nightly reports with spark and python');
  kept('work[1].highlights[0]', 'Automated the nightly reports with Spark and Python', { base: lower });
  const hyphen = withBullet(0, 0, 'Built Go-based billing services for 2,000 merchants');
  kept('work[0].highlights[0]', 'Built billing services in Go for 2,000 merchants', { base: hyphen });
  // Seen live on gpt-6-luna: the fit read's "Payment APIs" against a base that says "payment
  // and billing APIs". A posting phrase counts when its words are in the evidence.
  const billing = { ...TAILOR_BASE, basics: { ...TAILOR_BASE.basics, summary: 'Backend engineer who builds payment and billing APIs in Go.' } };
  kept('basics.summary', 'Backend engineer who builds payment APIs in Go.', { base: billing, jobTerms: ['Payment APIs'] });
  // A short posting term like "IT" doesn't make every "it" a skill.
  kept('work[0].highlights[4]', 'Presented the migration plan and its risks to leadership', { jobTerms: ['IT'] });
});

test('two skill groups with the same name do not crash tailoring', () => {
  const base: StructuredResume = {
    ...TAILOR_BASE,
    skills: [
      { category: 'General', skills: ['Go'] },
      { category: 'General', skills: ['Python'] },
    ],
  };
  const result = tailorFromAnswer(base, emptyAnswer({ skills_order: ['Python', 'Go'] }), { ...TAILOR_JOB, confirmedKeywords: [] });
  assert.deepEqual(result.resume.skills, base.skills);
});

test('a confirmed keyword already on the résumé by another name is not added twice', () => {
  const result = tailorFromAnswer(
    TAILOR_BASE,
    emptyAnswer({ added_skills: [{ skill: 'Golang', category: 'Languages' }] }),
    { ...TAILOR_JOB, confirmedKeywords: ['Postgres'] },
  );
  assert.deepEqual(result.resume.skills, TAILOR_BASE.skills);
  assert.deepEqual(result.details, []);
});

test('gaps with a qualifier the résumé lacks are kept', () => {
  const base = { ...TAILOR_BASE, skills: [...TAILOR_BASE.skills, { category: 'Other', skills: ['R', 'C'] }] };
  const result = tailorFromAnswer(
    base,
    emptyAnswer({
      skills_order: ['Go', 'Python', 'SQL', 'PostgreSQL', 'Docker', 'R', 'C'],
      gaps: [
        '5+ years of professional Go experience',
        'Experience leading teams using Python',
        'Docker Swarm orchestration',
        'Go-to-market experience',
        'R&D experience',
        'Advanced SQL experience',
      ],
    }),
    { ...TAILOR_JOB, confirmedKeywords: [] },
  );
  assert.deepEqual(result.gaps, [
    '5+ years of professional Go experience',
    'Experience leading teams using Python',
    'Docker Swarm orchestration',
    'Go-to-market experience',
    'R&D experience',
  ]);
});

test('a flood of suggestions is capped', () => {
  const edits = Array.from({ length: 500 }, (_v, i) => edit(`work[0].highlights[${i + 10}]`, 'x', `no such line ${i}`));
  const result = tailorFromAnswer(TAILOR_BASE, emptyAnswer({ edits }), { ...TAILOR_JOB, confirmedKeywords: [] });
  assert.ok(result.details.length <= 50, `${result.details.length} details`);
});
