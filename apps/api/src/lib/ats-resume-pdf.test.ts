import assert from 'node:assert/strict';
import test from 'node:test';
import type { StructuredResume } from '@/types';
import { renderAtsResumePdf, renderResumePdf } from './ats-resume-pdf';
import { flat, readPdf } from '@/test-support/pdf-read';

/**
 * The résumé PDF (#352): wrapped, paged, Unicode text in one serif face, in the owner's
 * reference look, fitted to one page when it can be, and readable by a strict parser.
 */

const words = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(' ');

function resume(overrides: Partial<StructuredResume> = {}): StructuredResume {
  return {
    basics: {
      name: 'Zoë Núñez – Ramírez',
      label: 'Backend Engineer',
      email: 'zoe@example.com',
      phone: '+1 555 0142',
      url: 'https://zoe.dev',
      summary: 'Backend engineer who builds payment APIs in Go.',
      location: { city: 'Austin', region: 'TX' },
      profiles: [{ network: 'LinkedIn', url: 'https://www.linkedin.com/in/zoe-nunez' }],
    },
    work: [
      {
        company: 'Globex',
        position: 'Backend Engineer',
        location: 'Remote',
        startDate: '2026-05-01',
        current: true,
        // The parse put the header line here; it only repeats the role.
        summary: 'Backend Engineer Globex May 2026 – Present',
        highlights: ['Cut p95 latency by 40% in 2024 with Python 3.11, saving $1.2M for 10+ teams', 'Built the billing API in Go'],
      },
    ],
    education: [{ institution: 'University of Texas at Austin', studyType: 'BSc', area: 'Computer Science', endDate: '2019' }],
    skills: [{ category: 'Languages', skills: ['Go', 'Python', 'SQL'] }],
    projects: [{ name: 'Ledger', description: 'A double-entry ledger in Go.', highlights: ['A double-entry ledger in Go.'] }],
    ...overrides,
  };
}

test('a long résumé wraps every line, breaks pages, and keeps every character', async () => {
  const bullets = Array.from({ length: 40 }, (_, i) => `Bullet ${i}: ${words(18, `w${i}x`)}`);
  bullets[7] = `Long bullet: ${words(60, 'longword').slice(0, 386)}`;
  assert.ok(bullets[7]!.length >= 390);
  const long = resume({ work: [{ company: 'Globex', position: 'Engineer', startDate: '2020-01', highlights: bullets }] });

  const { pages, text } = await readPdf(await renderAtsResumePdf(long));
  assert.ok(pages.length >= 2, `${pages.length} page(s)`);
  assert.ok(text.includes('Zoë Núñez – Ramírez'), 'the exact name');
  const all = flat(pages.flatMap((page) => page.lines).join(' '));
  for (const bullet of bullets) assert.ok(all.includes(flat(bullet)), `missing: ${bullet.slice(0, 40)}…`);
  for (const page of pages) {
    for (const item of page.items) {
      assert.ok(item.x + item.width <= page.width - 28.8 + 0.5, `"${item.str}" runs past the right margin`);
      assert.ok(item.x >= 28.8 - 0.5, `"${item.str}" starts in the left margin`);
    }
  }
});

test('a résumé a little over one page is fitted onto one, with all its text', async () => {
  const bullets = Array.from({ length: 30 }, (_, i) => `Shipped thing ${i} ${words(12, 'detail')}`);
  const over = resume({ work: [{ company: 'Globex', position: 'Engineer', startDate: '2020-01', highlights: bullets }] });

  assert.equal((await renderResumePdf(over, { fit: false })).pages, 2, 'over one page at the default size');
  const fitted = await renderResumePdf(over);
  assert.equal(fitted.pages, 1);
  const { pages } = await readPdf(fitted.pdf);
  assert.equal(pages.length, 1);
  const all = flat(pages[0]!.lines.join(' '));
  for (const bullet of bullets) assert.ok(all.includes(flat(bullet)));
  // Never below 9.5 pt.
  assert.ok(pages[0]!.items.every((item) => item.str.trim() === '' || item.width > 0));
});

test('the reference look: human dates, no repeated role line, projects once, links', async () => {
  const pdf = await renderAtsResumePdf(resume());
  const { pages, text } = await readPdf(pdf);
  assert.equal(pages.length, 1);
  assert.match(text, /May 2026 – Present/);
  assert.doesNotMatch(text, /2026-05-01/);
  assert.doesNotMatch(text, /Backend Engineer Globex May 2026/);
  assert.equal(text.split('A double-entry ledger in Go.').length - 1, 1, 'the project text printed once');
  assert.match(text, /zoe@example\.com/);
  // pdfjs reports a bare host with a trailing slash.
  assert.deepEqual(pages[0]!.links.map((l) => l.replace(/\/$/, '')).sort(), ['https://www.linkedin.com/in/zoe-nunez', 'https://zoe.dev', 'mailto:zoe@example.com']);
  assert.ok(!Buffer.from(pdf).toString('latin1').includes('/Helvetica'), 'no base-14 Helvetica');
});

test('metrics in bullets are bold; years and versions are not', async () => {
  const { pages } = await readPdf(await renderAtsResumePdf(resume()));
  const fontOf = (str: string) => pages[0]!.items.find((item) => item.str.includes(str))?.font ?? '';
  for (const metric of ['40%', '$1.2M', '10+']) assert.match(fontOf(metric), /Bold/, `${metric} is bold`);
  for (const plain of ['2024', '3.11']) assert.doesNotMatch(fontOf(plain), /Bold/, `${plain} is not bold`);
});

test('sections print in the layout order, with its titles, skipping hidden ones', async () => {
  const laidOut = resume({
    layout: {
      sections: [{ key: 'skills', title: 'Technical Skills' }, { key: 'work' }, { key: 'education' }, { key: 'projects', hidden: true }],
    },
  });
  const { text } = await readPdf(await renderAtsResumePdf(laidOut));
  const at = (heading: string) => text.indexOf(heading);
  assert.ok(at('Technical Skills') >= 0 && at('Technical Skills') < at('Experience') && at('Experience') < at('Education'), text);
  assert.ok(!text.includes('Ledger'), 'projects are hidden');
  // A section the layout doesn't list keeps its place after the listed ones.
  assert.ok(at('Summary') > at('Education'));
});

test('A4 when the layout asks for it, Letter by default', async () => {
  const letter = await readPdf(await renderAtsResumePdf(resume()));
  assert.deepEqual([Math.round(letter.pages[0]!.width), Math.round(letter.pages[0]!.height)], [612, 792]);
  const a4 = await readPdf(await renderAtsResumePdf(resume({ layout: { pageSize: 'a4' } })));
  assert.deepEqual([Math.round(a4.pages[0]!.width), Math.round(a4.pages[0]!.height)], [595, 842]);
});

test('an empty résumé still renders a page', async () => {
  const empty: StructuredResume = { basics: { name: 'A', email: '', summary: '' }, work: [], education: [], skills: [] };
  const { pages } = await readPdf(await renderAtsResumePdf(empty));
  assert.equal(pages.length, 1);
});
