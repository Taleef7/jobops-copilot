import assert from 'node:assert/strict';
import test from 'node:test';
import { tailorFromAnswer, type TailorContext } from './apply';
import { editableLines } from './lines';
import { TAILOR_BASE, TAILOR_JOB, edit, emptyAnswer } from '@/test-support/tailor-fixtures';
import type { TailorAnswer } from './answer';
import type { ResumeChangeDetail, StructuredResume } from '@/types';

const ctx = (confirmedKeywords: string[] = []): TailorContext => ({ ...TAILOR_JOB, confirmedKeywords });

function run(answer: Partial<TailorAnswer>, confirmed: string[] = [], base: StructuredResume = TAILOR_BASE) {
  return tailorFromAnswer(base, emptyAnswer(answer), ctx(confirmed));
}

/** The one rewrite detail for a single edit, and the line in the tailored résumé. */
function one(path: string, newText: string, confirmed: string[] = []) {
  const result = run({ edits: [edit(path, newText)] }, confirmed);
  const rewrites = result.details.filter((d) => d.kind === 'rewrite');
  assert.equal(rewrites.length, 1, `one detail for ${path}: ${JSON.stringify(result.details)}`);
  return { detail: rewrites[0]!, result };
}

const codes = (detail: ResumeChangeDetail) => (detail.issues ?? []).map((issue) => issue.code);
const kept = (path: string, newText: string, confirmed: string[] = []) => {
  const { detail } = one(path, newText, confirmed);
  assert.equal(detail.dropped, false, `kept: ${newText} (${JSON.stringify(detail.issues)})`);
  return detail;
};
const dropped = (path: string, newText: string, code: string, term?: string) => {
  const { detail, result } = one(path, newText);
  assert.equal(detail.dropped, true, `dropped: ${newText}`);
  assert.ok(codes(detail).includes(code as never), `${code} in ${JSON.stringify(detail.issues)}`);
  if (term) assert.ok(detail.issues?.some((issue) => issue.term === term), `term ${term} in ${JSON.stringify(detail.issues)}`);
  // The résumé keeps the base line.
  assert.deepEqual(result.resume, TAILOR_BASE);
  return detail;
};

test('only the summary and the bullets are offered for editing, blank ones left out', () => {
  const base: StructuredResume = {
    ...TAILOR_BASE,
    basics: { ...TAILOR_BASE.basics, summary: '  ' },
    work: [{ ...TAILOR_BASE.work[0]!, highlights: ['Built the billing API', ''] }],
  };
  assert.deepEqual(editableLines(base), [{ path: 'work[0].highlights[0]', text: 'Built the billing API', role: 0 }]);
});

test('a reworded bullet that keeps its facts is applied, with the base text as the old text', () => {
  const detail = kept('work[0].highlights[1]', 'Cut p95 latency 40% by adding Redis caching');
  assert.equal(detail.section, 'Experience · Globex');
  assert.equal(detail.sourcePath, 'work[0].highlights[1]');
  assert.equal(detail.oldText, 'Reduced p95 latency by 40% with Redis caching');
  assert.deepEqual(detail.issues, []);
  const { result } = one('work[0].highlights[1]', 'Cut p95 latency 40% by adding Redis caching');
  assert.equal(result.resume.work[0]!.highlights[1], 'Cut p95 latency 40% by adding Redis caching');
});

test('numbers: the same value in another form passes; a new or changed one is dropped', () => {
  kept('work[0].highlights[0]', 'Built the billing API in Go for 2000 merchants');
  kept('work[0].highlights[1]', 'Reduced p95 latency by 40 percent with Redis caching');
  kept('work[0].highlights[1]', 'Reduced p95 latency by 40\u00A0% with Redis caching');
  kept('work[0].highlights[1]', 'Cut p95 latency by 40\uFF05 with Redis caching');
  kept('work[0].highlights[2]', 'Mentored 2 interns');
  kept('work[1].highlights[1]', 'Migrated three services to EC2 and S3');
  kept('work[1].highlights[2]', 'Cut build time from 12-15 minutes to 4 minutes');
  dropped('work[0].highlights[1]', 'Reduced p95 latency by 60% with Redis caching', 'NEW_NUMBER', '60%');
  dropped('work[0].highlights[1]', 'Reduced p95 latency 40x with Redis caching', 'NEW_NUMBER', '40x');
  dropped('work[0].highlights[2]', 'Mentored three interns', 'NEW_NUMBER', 'three');
  dropped('work[1].highlights[0]', 'Since 2018, automated nightly reports with Python, saving 10 hours a week', 'NEW_DATE', '2018');
  dropped('basics.summary', 'Backend engineer with 6 years of experience building payment APIs in Go', 'NEW_NUMBER', '6');
});

test('a tool the role never names is dropped, even one from the skills list', () => {
  const detail = dropped('work[0].highlights[0]', 'Built the billing API in Go and Kafka serving 2,000 merchants', 'NEW_SKILL', 'Kafka');
  assert.match(detail.dropReason ?? '', /Kafka/);
  // Python is a skill, and Initech's bullets name it, but Globex's don't.
  dropped('work[0].highlights[0]', 'Built the billing API in Go and Python serving 2,000 merchants', 'NEW_SKILL', 'Python');
  dropped('basics.summary', 'Backend engineer who builds payment APIs in Go and Kubernetes', 'NEW_SKILL', 'Kubernetes');
  dropped('work[1].highlights[3]', 'Wrote C# services in Go', 'NEW_SKILL', 'C#');
});

test('names that look like tools but are not, and aliases of tools the line has, pass', () => {
  kept('work[0].highlights[3]', 'Partnered with the Sales team on the go-to-market launch');
  kept('work[1].highlights[3]', 'Wrote C++ services in Go');
  kept('work[0].highlights[4]', 'Presented the migration plan to senior leadership');
  kept('basics.summary', 'Backend engineer building payment APIs in Go and Python, with PostgreSQL and Docker');
});

test('a new employer name, degree or seniority is dropped', () => {
  dropped('basics.summary', 'Backend engineer who builds payment APIs in Go, ready to help Acme Pay grow', 'NEW_ENTITY', 'Acme Pay');
  dropped('basics.summary', 'Backend engineer with an MSc who builds payment APIs in Go', 'NEW_ENTITY', 'msc');
  dropped('basics.summary', 'Senior backend engineer who builds payment APIs in Go', 'NEW_SENIORITY', 'senior');
});

test('a line that is not a rewording of its source is dropped', () => {
  dropped('work[0].highlights[2]', 'Designed the event-driven settlement platform', 'NOT_A_REWRITE');
});

test('a suggestion for a line that is not in the résumé is dropped, and nothing is inserted', () => {
  for (const path of ['work[0].highlights[7]', '', 'work[0].company', '__proto__', 'work[01].summary', 'basics.name']) {
    const result = run({ edits: [edit(path, 'Led the payments platform', 'Something else')] });
    assert.deepEqual(result.resume, TAILOR_BASE, `${path} changes nothing`);
    const [detail] = result.details;
    assert.equal(detail?.dropped, true, `${path} is shown as dropped`);
    assert.deepEqual(codes(detail!), ['INVALID_PATH']);
    assert.equal(detail?.oldText, null);
  }
});

test('an empty summary is not offered, and an edit to it is dropped', () => {
  const base = { ...TAILOR_BASE, basics: { ...TAILOR_BASE.basics, summary: '' } };
  const result = run({ edits: [edit('basics.summary', 'Backend engineer who builds payment APIs in Go.', '')] }, [], base);
  assert.equal(result.resume.basics.summary, '');
  assert.equal(result.details[0]?.dropped, true);
});

test('an index slip is fixed by the old text; a path that is right wins over a misquote', () => {
  const slipped = run({
    edits: [edit('work[0].highlights[2]', 'Cut p95 latency 40% with Redis caching', TAILOR_BASE.work[0]!.highlights[1])],
  });
  assert.equal(slipped.resume.work[0]!.highlights[1], 'Cut p95 latency 40% with Redis caching');
  assert.equal(slipped.resume.work[0]!.highlights[2], 'Mentored two interns');
  assert.equal(slipped.details[0]?.sourcePath, 'work[0].highlights[1]');

  const misquoted = run({ edits: [edit('work[0].highlights[2]', 'Mentored 2 interns', 'Mentored interns')] });
  assert.equal(misquoted.resume.work[0]!.highlights[2], 'Mentored 2 interns');
});

test('a second suggestion for one line is ignored, and an unchanged line is not a change', () => {
  const twice = run({
    edits: [edit('work[0].highlights[2]', 'Mentored 2 interns'), edit('work[0].highlights[2]', 'Mentored a pair of interns')],
  });
  assert.equal(twice.resume.work[0]!.highlights[2], 'Mentored 2 interns');
  assert.equal(twice.details.length, 1);

  const same = run({ edits: [edit('work[0].highlights[2]', '  mentored two Interns ')] });
  assert.deepEqual(same.details, []);
  assert.equal(same.changed, false);
});

test('only known fields of the answer are read', () => {
  const answer = {
    ...emptyAnswer({ edits: [edit('work[0].highlights[2]', 'Mentored 2 interns')] }),
    structured_resume: { ...TAILOR_BASE, work: [{ ...TAILOR_BASE.work[0]!, startDate: '2015-01-01' }] },
  };
  const result = tailorFromAnswer(TAILOR_BASE, answer, ctx());
  assert.equal(result.resume.work[0]!.startDate, '2022-01-01');
});

test('bullets are reordered only by a full reordering of the role', () => {
  const reordered = run({ highlight_orders: [{ work_index: 0, highlight_order: [1, 0, 2, 3, 4] }] });
  assert.deepEqual(reordered.resume.work[0]!.highlights.slice(0, 2), [
    'Reduced p95 latency by 40% with Redis caching',
    'Built the billing API in Go serving 2,000 merchants',
  ]);
  const detail = reordered.details.find((d) => d.kind === 'reorder');
  assert.equal(detail?.section, 'Experience · Globex');
  assert.equal(detail?.sourcePath, 'work[0].highlights');

  for (const order of [[0, 0, 9], [1, 0], [0, 1, 2, 3, 4]]) {
    const ignored = run({ highlight_orders: [{ work_index: 0, highlight_order: order }] });
    assert.deepEqual(ignored.resume, TAILOR_BASE, `order ${order} keeps the base order`);
    assert.deepEqual(ignored.details, []);
  }
  assert.deepEqual(run({ highlight_orders: [{ work_index: 7, highlight_order: [0] }] }).resume, TAILOR_BASE);
});

test('a rewritten bullet moves with its new text when its role is reordered', () => {
  const result = run({
    edits: [edit('work[0].highlights[1]', 'Cut p95 latency 40% with Redis caching')],
    highlight_orders: [{ work_index: 0, highlight_order: [1, 0, 2, 3, 4] }],
  });
  assert.equal(result.resume.work[0]!.highlights[0], 'Cut p95 latency 40% with Redis caching');
});

test('skills are reordered within their groups, and only by an exact reordering', () => {
  const result = run({ skills_order: ['SQL', 'Docker', 'Go', 'PostgreSQL', 'Python'] });
  assert.deepEqual(result.resume.skills, [
    { category: 'Languages', skills: ['SQL', 'Go', 'Python'] },
    { category: 'Infrastructure', skills: ['Docker', 'PostgreSQL'] },
  ]);
  assert.ok(result.details.some((d) => d.kind === 'skills-reorder'));

  for (const order of [['SQL', 'Go', 'Python', 'PostgreSQL', 'Docker', 'Kafka'], ['SQL', 'Go'], []]) {
    const ignored = run({ skills_order: order });
    assert.deepEqual(ignored.resume.skills, TAILOR_BASE.skills, `${order} keeps the base order`);
  }
});

test("a confirmed keyword may be used in a line, and is marked as the user's", () => {
  const detail = kept('work[0].highlights[0]', 'Built the billing API in Go and Kafka serving 2,000 merchants', ['Kafka']);
  assert.deepEqual(detail.confirmedTerms, ['Kafka']);
  assert.equal(detail.needsReview, true);
});

test('a confirmed keyword goes into the skills, under the group the model chose when it exists', () => {
  const placed = run({ added_skills: [{ skill: 'Kafka', category: 'Infrastructure' }] }, ['Kafka']);
  assert.deepEqual(placed.resume.skills[1], { category: 'Infrastructure', skills: ['PostgreSQL', 'Docker', 'Kafka'] });
  const detail = placed.details.find((d) => d.kind === 'skill-added');
  assert.equal(detail?.section, 'Skills · Infrastructure');
  assert.equal(detail?.newText, 'Kafka');
  assert.equal(detail?.dropped, false);

  // The model left it out, or named a group the résumé doesn't have: it goes under "Other".
  for (const added of [[], [{ skill: 'Kafka', category: 'Streaming' }]]) {
    const result = run({ added_skills: added }, ['Kafka']);
    assert.deepEqual(result.resume.skills[2], { category: 'Other', skills: ['Kafka'] });
  }
  // A résumé with one group, or none.
  const single = { ...TAILOR_BASE, skills: [{ category: 'Skills', skills: ['Go'] }] };
  assert.deepEqual(run({ skills_order: ['Go'] }, ['Kafka'], single).resume.skills, [{ category: 'Skills', skills: ['Go', 'Kafka'] }]);
  const none = { ...TAILOR_BASE, skills: [] };
  assert.deepEqual(run({ skills_order: [] }, ['Kafka'], none).resume.skills, [{ category: 'Skills', skills: ['Kafka'] }]);
  // Already a skill: nothing added.
  assert.deepEqual(run({}, ['go']).resume.skills, TAILOR_BASE.skills);
});

test('a skill the user did not confirm is never added, and shows as dropped', () => {
  const result = run({ added_skills: [{ skill: 'Kubernetes', category: 'Infrastructure' }] });
  assert.deepEqual(result.resume.skills, TAILOR_BASE.skills);
  const detail = result.details.find((d) => d.kind === 'skill-added');
  assert.equal(detail?.dropped, true);
  assert.match(detail?.dropReason ?? '', /Kubernetes/);
});

test('a leadership claim the source line does not make is kept but marked for review', () => {
  const detail = kept('work[0].highlights[0]', 'Built and owned the billing API in Go serving 2,000 merchants');
  assert.equal(detail.needsReview, true);
  assert.ok(codes(detail).includes('LEADERSHIP_CLAIM'));
});

test('gaps the résumé or the user already covers are left out', () => {
  const result = run(
    { gaps: ['Advanced SQL experience', 'Kafka streaming', 'Snowflake', 'kafka streaming', ''] },
    ['Snowflake'],
  );
  assert.deepEqual(result.gaps, ['Kafka streaming']);
});

test('the change summary is written from what was applied, not from the model', () => {
  const result = run({
    change_summary: 'Added Kubernetes and 10 years of leadership.',
    edits: [
      edit('work[0].highlights[1]', 'Cut p95 latency 40% with Redis caching'),
      edit('work[0].highlights[0]', 'Built the billing API in Go and Kafka serving 2,000 merchants'),
    ],
    highlight_orders: [{ work_index: 0, highlight_order: [1, 0, 2, 3, 4] }],
  });
  assert.equal(result.changeSummary, 'Reworded 1 line and reordered bullets in 1 role. 1 suggestion was dropped.');
  assert.equal(result.changed, true);
  assert.deepEqual(
    result.details.map((d) => d.id),
    result.details.map((_d, i) => `c${i}`),
  );
});

test('employers, titles, dates, education and contact details are never changed', () => {
  const result = run({
    edits: [edit('basics.summary', 'Backend engineer building payment APIs in Go'), edit('work[0].highlights[2]', 'Mentored 2 interns')],
    highlight_orders: [{ work_index: 1, highlight_order: [3, 2, 1, 0] }],
  });
  const strip = (resume: StructuredResume) => ({
    ...resume,
    basics: { ...resume.basics, summary: '' },
    work: resume.work.map((role) => ({ ...role, highlights: [] })),
  });
  assert.deepEqual(strip(result.resume), strip(TAILOR_BASE));
  assert.equal(TAILOR_BASE.work[0]!.highlights[2], 'Mentored two interns', 'the base résumé is not mutated');
});
