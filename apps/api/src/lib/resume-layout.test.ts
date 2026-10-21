import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResumeLayout, ResumeVersionRecord, StructuredResume } from '@/types';
import { layoutFrozen, parseLayoutPatch, resolveLayout, withBaseLayout } from './resume-layout';

/** The résumé's section layout (#415): defaults, the PATCH check, and tailored drafts. */

const DEFAULT_ORDER = ['summary', 'work', 'education', 'skills', 'projects', 'certificates'];
const keys = (layout: ResumeLayout | undefined) => resolveLayout({ layout }).sections.map((s) => s.key);

test('resolveLayout: no layout is the default order and titles, on Letter', () => {
  const resolved = resolveLayout({});
  assert.deepEqual(resolved.sections.map((s) => s.key), DEFAULT_ORDER);
  assert.deepEqual(resolved.sections.map((s) => s.title), ['Summary', 'Experience', 'Education', 'Skills', 'Projects', 'Certifications']);
  assert.equal(resolved.pageSize, 'letter');
});

test('resolveLayout: a duplicate key is dropped, the first one counts', () => {
  const resolved = resolveLayout({ layout: { sections: [{ key: 'skills', title: 'Tools' }, { key: 'skills', title: 'Again' }] } });
  assert.deepEqual(resolved.sections.map((s) => s.key), ['skills', 'summary', 'work', 'education', 'projects', 'certificates']);
  assert.equal(resolved.sections[0]!.title, 'Tools');
});

test('resolveLayout: a missing key is appended, shown, in the default order', () => {
  assert.deepEqual(keys({ sections: [{ key: 'education' }, { key: 'work' }] }), ['education', 'work', 'summary', 'skills', 'projects', 'certificates']);
});

test('resolveLayout: a blank title falls back to the default title', () => {
  const resolved = resolveLayout({ layout: { sections: [{ key: 'work', title: '   ' }] } });
  assert.equal(resolved.sections.find((s) => s.key === 'work')!.title, 'Experience');
});

test('resolveLayout: a hidden section is left out', () => {
  assert.deepEqual(keys({ sections: [{ key: 'projects', hidden: true }] }), ['summary', 'work', 'education', 'skills', 'certificates']);
});

test('parseLayoutPatch takes the layout as the editor sends it, trimmed', () => {
  const parsed = parseLayoutPatch({
    sections: [
      { key: 'skills', title: '  Technical Skills ' },
      { key: 'education' },
      { key: 'work', title: 'Professional Experience' },
      { key: 'summary', title: '' },
      { key: 'projects', hidden: true },
      { key: 'certificates', hidden: false },
    ],
    pageSize: 'a4',
  });
  assert.deepEqual(parsed, {
    layout: {
      sections: [
        { key: 'skills', title: 'Technical Skills' },
        { key: 'education' },
        { key: 'work', title: 'Professional Experience' },
        { key: 'summary' },
        { key: 'projects', hidden: true },
        { key: 'certificates' },
      ],
      pageSize: 'a4',
    },
  });
  assert.deepEqual(parseLayoutPatch({ pageSize: 'letter' }), { layout: { pageSize: 'letter' } });
});

test('parseLayoutPatch refuses a malformed layout, saying what is wrong', () => {
  const bad: Array<[unknown, RegExp]> = [
    [null, /object/],
    [[], /object/],
    ['skills', /object/],
    [{}, /sections or pageSize/],
    [{ sections: 'skills' }, /list/],
    [{ sections: [{ key: 'awards' }] }, /awards/],
    [{ sections: [{ key: 'skills' }, { key: 'skills' }] }, /twice/],
    [{ sections: [null] }, /section/],
    [{ sections: [{ key: 'skills', hidden: 'yes' }] }, /hidden/],
    [{ sections: [{ key: 'skills', title: 42 }] }, /title/],
    [{ sections: [{ key: 'skills', title: 'x'.repeat(61) }] }, /60/],
    [{ sections: [{ key: 'skills', title: 'Two\nlines' }] }, /title/],
    [{ sections: [{ key: 'skills', order: 1 }] }, /order/],
    [{ pageSize: 'legal' }, /pageSize/],
    [{ sections: [], theme: 'dark' }, /theme/],
  ];
  for (const [body, message] of bad) {
    const parsed = parseLayoutPatch(body);
    assert.ok('error' in parsed, `${JSON.stringify(body)} is refused`);
    assert.match(parsed.error, message, JSON.stringify(body));
  }
});

const base: StructuredResume = {
  basics: { name: 'Jordan Lee', email: 'jordan@example.com', summary: 'Engineer.' },
  work: [],
  education: [],
  skills: [],
};

const draft = (overrides: Partial<ResumeVersionRecord> = {}): ResumeVersionRecord => ({
  id: 'v1',
  userId: 'u1',
  jobId: 'j1',
  changeSummary: 'Tailored',
  structuredResume: { ...base, layout: { sections: [{ key: 'skills' }] } },
  approved: false,
  isBase: false,
  basedOn: {
    baseVersionId: null,
    baseUpdatedAt: null,
    jobId: 'j1',
    postingSha256: 'x',
    model: 'm',
    createdAt: '2026-10-01T00:00:00.000Z',
    grounding: { version: 1 },
  },
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

test("a draft follows the base layout until it's downloaded or its job is marked applied", () => {
  assert.equal(layoutFrozen(draft()), false);
  assert.equal(layoutFrozen(draft({ approved: true })), true);
  assert.equal(layoutFrozen(draft({ basedOn: { ...draft().basedOn!, layoutFrozenAt: '2026-10-02T00:00:00.000Z' } })), true);
});

test("withBaseLayout puts the base résumé's layout on a draft, and only the layout", () => {
  const now = { sections: [{ key: 'education' as const, title: 'Schooling' }], pageSize: 'a4' as const };
  const moved = withBaseLayout(draft().structuredResume, { ...base, summary: 'ignored', layout: now } as StructuredResume);
  assert.deepEqual(moved, { ...base, layout: now });
  // A base résumé with no layout: the default, not the draft's old copy.
  assert.deepEqual(withBaseLayout(draft().structuredResume, base), base);
  // No base résumé at all: the draft keeps its own.
  assert.deepEqual(withBaseLayout(draft().structuredResume, null), draft().structuredResume);
});
