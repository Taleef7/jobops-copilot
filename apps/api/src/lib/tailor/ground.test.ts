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
  return detail;
}

/** Kept, but marked for the user to look at, with the word that needs a look. */
function reviewed(path: string, newText: string, term: string, options: Parameters<typeof outcome>[2] = {}) {
  const detail = kept(path, newText, options);
  assert.equal(detail.needsReview, true, `should need review: ${newText}`);
  assert.ok(detail.issues?.some((issue) => issue.term === term), `${term} in ${JSON.stringify(detail.issues)}`);
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
  ]) {
    dropped('work[0].highlights[0]', text);
  }
});

test('a capitalised word or short acronym the résumé lacks is kept but marked for review', () => {
  // Too often honest ("Registered nurse (RN)", "Microsoft Excel") to drop; the user sees it.
  reviewed('work[0].highlights[0]', 'Built the billing API in Go with Memcached serving 2,000 merchants', 'Memcached');
  reviewed('basics.summary', 'Ex-Google backend engineer who builds payment APIs in Go.', 'Google');
  const nurse = withBullet(1, 0, 'Triaged patients in the emergency department as a registered nurse');
  reviewed('work[1].highlights[0]', 'Triaged patients in the Emergency Department (ED) as a Registered Nurse (RN)', 'ED', {
    base: nurse,
  });
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
  // The skill Go doesn't cover "go-to-market"; this résumé has no go-to-market work.
  const base = withBullet(0, 3, 'Partnered with sales on the enterprise launch');
  base.skills = [...TAILOR_BASE.skills, { category: 'Other', skills: ['R', 'C'] }];
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

// Second review (#351): honest rewrites that were dropped, on résumés other than an engineer's.
test('a title the original line already names is not a new claim', () => {
  const board = withBullet(0, 4, 'Prepared the weekly KPI briefing for the board and the CEO');
  kept('work[0].highlights[4]', 'Prepared the weekly KPI briefing for the CEO and the board', { base: board });
  const vp = withBullet(0, 4, 'Presented the roadmap to the VP of Sales');
  kept('work[0].highlights[4]', 'Presented the roadmap to the Vice President of Sales', { base: vp });
  const lead = withBullet(0, 4, 'Served as night-shift team lead for the payments services');
  kept('work[0].highlights[4]', 'Served as team lead on the night shift for the payments services', { base: lead });
  // Adding one is still a claim.
  dropped('work[0].highlights[4]', 'Presented the migration plan to the CEO');
});

test('numbers in another honest form are kept', () => {
  const revenue = withBullet(0, 0, 'Grew billing revenue to $1,200,000 for 2,000 merchants');
  kept('work[0].highlights[0]', 'Grew billing revenue to $1.2M for 2,000 merchants', { base: revenue });
  kept('work[0].highlights[0]', 'Grew billing revenue to $1.2MM for 2,000 merchants', { base: revenue });
  const ms = withBullet(0, 1, 'Cut p95 latency to 40 ms with Redis caching');
  kept('work[0].highlights[1]', 'Cut p95 latency to 40ms with Redis caching', { base: ms });
  const words = {
    ...TAILOR_BASE,
    basics: { ...TAILOR_BASE.basics, summary: 'Backend engineer with eight years of experience building payment APIs in Go.' },
  };
  kept('basics.summary', 'Payments backend engineer with 8 years of experience building APIs in Go.', { base: words });
  const ten = withBullet(1, 0, 'Automated nightly reports with Python, saving ten hours a week');
  kept('work[1].highlights[0]', 'Automated the nightly reports with Python, saving 10 hours a week', { base: ten });
  const times = withBullet(0, 1, 'Made p95 latency 3 times lower with Redis caching');
  kept('work[0].highlights[1]', 'Made p95 latency 3x lower with Redis caching', { base: times });
  const half = withBullet(0, 1, 'Cut p95 latency by half with Redis caching');
  kept('work[0].highlights[1]', 'Halved p95 latency with Redis caching', { base: half });
  const dashboards = withBullet(1, 0, 'Built 25 reporting dashboards with Python for the finance team');
  kept('work[1].highlights[0]', 'Built twenty-five reporting dashboards with Python for the finance team', { base: dashboards });
  const covid = withBullet(1, 0, 'Automated covid testing reports with Python for 300 clinics');
  kept('work[1].highlights[0]', 'Automated COVID-19 testing reports with Python for 300 clinics', { base: covid });
  const micro = withBullet(1, 0, 'Automated assay runs at 10 µL volumes with Python');
  kept('work[1].highlights[0]', 'Automated the assay runs at 10 µL volumes with Python', { base: micro });
});

test('a word that only looks like a tool or the posting company is not one', () => {
  const csuite = withBullet(0, 4, 'Presented the migration plan to the executive team');
  kept('work[0].highlights[4]', 'Presented the migration plan to the C-suite and the executive team', { base: csuite });
  const goal = withBullet(0, 3, 'Partnered with sales to meet the quarterly revenue goal');
  kept('work[0].highlights[3]', 'Partnered with sales to hit the quarterly revenue target', { base: goal, company: 'Target Corporation' });
  const interns = withBullet(0, 2, 'Helped two interns get started on the billing API');
  kept('work[0].highlights[2]', 'Helped two interns ramp up on the billing API', { base: interns, company: 'Ramp' });
});

// Second review (#351): inflations that still passed.
test('years of experience and rough counts in words are read', () => {
  for (const text of [
    'Backend engineer with a decade of experience who builds payment APIs in Go.',
    'Backend engineer with ten years of experience who builds payment APIs in Go.',
    'Backend engineer with 15-plus years of experience who builds payment APIs in Go.',
    'Backend engineer with 10 or more years of experience who builds payment APIs in Go.',
    'Backend engineer building payment APIs in Go since 2000.',
  ]) {
    dropped('basics.summary', text);
  }
  dropped('work[0].highlights[0]', 'Built the billing API in Go serving tens of thousands of merchants');
  dropped('work[0].highlights[1]', 'Made p95 latency twice as fast with Redis caching');
});

test('a title through other words is a claim', () => {
  for (const text of [
    'Backend lead who builds payment APIs in Go.',
    'Backend team leader who builds payment APIs in Go.',
    'Backend engineering supervisor who builds payment APIs in Go.',
    'Backend engineer and payments manager who builds payment APIs in Go.',
    'Backend engineer and vice-president of payments who builds payment APIs in Go.',
  ]) {
    dropped('basics.summary', text);
  }
  dropped('work[0].highlights[0]', 'Promoted to manager; built the billing API in Go serving 2,000 merchants');
});

test('a very long suggestion is dropped quickly, and a large résumé is checked quickly', () => {
  const started = performance.now();
  dropped('work[0].highlights[0]', `Built the billing API in Go serving 2,000 merchants ${"R&D's ".repeat(11_000)}`);
  assert.ok(performance.now() - started < 500, `long line took ${Math.round(performance.now() - started)} ms`);

  const line = (i: number) => `Built service ${i} for the billing platform in Go, ${'serving merchants and partners '.repeat(60)}`;
  const big: StructuredResume = {
    ...TAILOR_BASE,
    work: [{ ...TAILOR_BASE.work[0]!, highlights: Array.from({ length: 40 }, (_v, i) => line(i)) }],
  };
  const edits = big.work[0]!.highlights.map((text, i) => edit(`work[0].highlights[${i}]`, text.replace('Built', 'Developed'), text));
  const t0 = performance.now();
  tailorFromAnswer(big, emptyAnswer({ edits }), { ...TAILOR_JOB, confirmedKeywords: [] });
  assert.ok(performance.now() - t0 < 1500, `40 long bullets took ${Math.round(performance.now() - t0)} ms`);
});

test('a confirmed cloud is added even when the résumé names only its services', () => {
  const base = { ...TAILOR_BASE, skills: [{ category: 'Cloud', skills: ['EC2', 'S3'] }] };
  const result = tailorFromAnswer(base, emptyAnswer({ skills_order: ['EC2', 'S3'] }), { ...TAILOR_JOB, confirmedKeywords: ['AWS'] });
  assert.deepEqual(result.resume.skills, [{ category: 'Cloud', skills: ['EC2', 'S3', 'AWS'] }]);
});

test('lowercase gaps that name something the résumé lacks are kept', () => {
  const result = tailorFromAnswer(
    TAILOR_BASE,
    emptyAnswer({ gaps: ['docker swarm orchestration', 'Experience with postgres replication', 'Advanced SQL experience'] }),
    { ...TAILOR_JOB, confirmedKeywords: [] },
  );
  assert.deepEqual(result.gaps, ['docker swarm orchestration', 'Experience with postgres replication']);
});

// Third pass (#351).
test('a hyphenated number is checked unless the résumé has it or it names something', () => {
  dropped('basics.summary', 'Backend engineer since mid-2015 who builds payment APIs in Go.');
  const tier = withBullet(0, 0, 'Built the Tier-1 billing API in Go serving 2,000 merchants');
  dropped('work[0].highlights[0]', 'Built the Tier-3 billing API in Go serving 2,000 merchants', { base: tier });
  kept('work[0].highlights[0]', 'Built the billing API (Tier-1) in Go serving 2,000 merchants', { base: tier });
  const top = withBullet(0, 0, 'Built the billing API in Go for 2,000 merchants, a top 5 product');
  dropped('work[0].highlights[0]', 'Built the billing API in Go for 2,000 merchants, a top-10 product', { base: top });
  // An all-caps name with a number is a name: "COVID-19" (kept in the earlier test).
});

test('everyday words that contain a title word are not titles', () => {
  const marketer = {
    ...TAILOR_BASE,
    basics: { ...TAILOR_BASE.basics, summary: 'Demand and lead generation marketer for payment APIs in Go.' },
  };
  kept('basics.summary', 'Lead generation and demand marketer for payment APIs in Go.', { base: marketer });
  kept('basics.summary', 'Backend engineer whose principal focus is building payment APIs in Go.');
});

test('more honest number forms are kept', () => {
  const campaign = withBullet(0, 3, 'Partnered with sales on the 2023 go-to-market launch');
  kept('work[0].highlights[3]', 'Partnered with sales on the go-to-market launch in 2023', { base: campaign });
  const often = withBullet(0, 4, 'Presented the migration plan to leadership four times a year');
  kept('work[0].highlights[4]', 'Presented the migration plan to leadership 4 times a year', { base: often });
  const pct = withBullet(0, 1, 'Reduced p95 latency by forty percent with Redis caching');
  kept('work[0].highlights[1]', 'Reduced p95 latency by 40% with Redis caching', { base: pct });
  const half = withBullet(0, 1, 'Cut p95 latency in half with Redis caching');
  kept('work[0].highlights[1]', 'Halved p95 latency with Redis caching', { base: half });
  const many = withBullet(0, 0, 'Built the billing API in Go serving 15,000 merchants');
  kept('work[0].highlights[0]', 'Built the billing API in Go serving tens of thousands of merchants', { base: many });
  // A reduction is not a multiple: "40% lower" is not "1.4x faster".
  dropped('work[0].highlights[1]', 'Made p95 latency 1.4x faster with Redis caching');
});

test('a compound or its initials in the résumé covers its one-word form', () => {
  const commerce = withBullet(0, 0, 'Built the e-commerce billing API in Go serving 2,000 merchants');
  kept('work[0].highlights[0]', 'Built the eCommerce billing API in Go serving 2,000 merchants', { base: commerce });
  const saas = withBullet(0, 0, 'Built the software-as-a-service billing API in Go serving 2,000 merchants');
  kept('work[0].highlights[0]', 'Built the SaaS billing API in Go serving 2,000 merchants', { base: saas });
  const target = withBullet(0, 3, 'Partnered with sales to hit the quarterly target on the launch');
  kept('work[0].highlights[3]', 'Target hit: partnered with sales on the quarterly launch', { base: target, company: 'Target' });
});

test('a title taken in a bullet, or more phrasings of years, are claims', () => {
  dropped('work[0].highlights[0]', 'As billing lead, built the billing API in Go serving 2,000 merchants');
  dropped('work[0].highlights[0]', 'Built the billing API in Go serving 2,000 merchants as manager of the billing team');
  const director = withBullet(0, 4, 'Presented the migration plan to the director');
  dropped('work[0].highlights[4]', 'Served as director and presented the migration plan', { base: director });
  dropped('work[0].highlights[0]', 'Promoted to staff; built the billing API in Go serving 2,000 merchants');
  for (const text of [
    'Backend engineer with 10 or so years of experience building payment APIs in Go.',
    'Backend engineer with ten-odd years of experience building payment APIs in Go.',
    'Backend engineer building payment APIs in Go over the past decade.',
    'Backend engineer with an associate degree who builds payment APIs in Go.',
  ]) {
    dropped('basics.summary', text);
  }
});
