import assert from 'node:assert/strict';
import test from 'node:test';
import type { StructuredResume } from '@/types';
import { renderAtsResumePdf, renderResumePdf } from './ats-resume-pdf';
import { ResumeTooLargeError } from '@/lib/input-caps';
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
  bullets[7] = `Long bullet: ${words(60, 'longword')}`.slice(0, 400).trim();
  assert.equal(bullets[7]!.length, 400);
  const long = resume({ work: [{ company: 'Globex', position: 'Engineer', startDate: '2020-01', highlights: bullets }] });

  const { pages, text } = await readPdf(await renderAtsResumePdf(long));
  assert.ok(pages.length >= 2, `${pages.length} page(s)`);
  assert.ok(text.includes('Zoë Núñez – Ramírez'), 'the exact name');
  const all = flat(pages.flatMap((page) => page.lines).join(' '));
  for (const bullet of bullets) assert.ok(all.includes(flat(bullet)), `missing: ${bullet.slice(0, 40)}…`);
  // Two pages are drawn at the regular size, with 0.5" margins.
  for (const page of pages) {
    for (const item of page.items) {
      assert.ok(item.x + item.width <= page.width - 36 + 0.5, `"${item.str}" runs past the right margin`);
      assert.ok(item.x >= 36 - 0.5, `"${item.str}" starts in the left margin`);
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
  // Never below 9.5 pt, the contact line included.
  const smallest = Math.min(...pages[0]!.items.filter((item) => item.str.trim()).map((item) => item.size));
  assert.ok(smallest >= 9.5 - 0.01, `${smallest} pt`);
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

test('a word longer than a line, or a huge field, renders fast and inside the page', async () => {
  // One field over the 5,000 cap is refused at save; the renderer must still be linear.
  const token = 'x'.repeat(40_000);
  const summary = Array.from({ length: 2_500 }, (_, i) => `word${i % 50}`).join(' ').slice(0, 4_900);
  const start = Date.now();
  const pdf = await renderAtsResumePdf(resume({ basics: { ...resume().basics, summary }, work: [{ company: 'Globex', position: 'Engineer', startDate: '2020-01', highlights: [token, `1,${'1,'.repeat(4000)}1 users`] }] }));
  assert.ok(Date.now() - start < 5_000, `${Date.now() - start} ms`);
  const { pages } = await readPdf(pdf);
  for (const page of pages) for (const item of page.items) assert.ok(item.x + item.width <= page.width - 36 + 0.5, `"${item.str.slice(0, 20)}" runs past the margin`);
  assert.ok(pages.flatMap((page) => page.lines).join('').includes('x'.repeat(40_000)), 'every character of the long word');
});

test('a heading is never left alone at the bottom of a page', async () => {
  const summary = Array.from({ length: 47 }, (_, i) => `Summary line ${i}.`).join('\n');
  const bullets = Array.from({ length: 30 }, (_, i) => `Shipped thing ${i}`);
  // Every fill of the first page, so one of them puts "Experience" near its foot.
  for (let lines = 40; lines <= 52; lines += 1) {
    const one = resume({
      basics: { ...resume().basics, summary: summary.split('\n').slice(0, lines).join('\n') },
      work: [{ company: 'Globex', position: 'Engineer', startDate: '2020-01', endDate: '2022-01', highlights: bullets }],
      education: [],
      skills: [],
      projects: [],
    });
    const { pages } = await readPdf((await renderResumePdf(one, { fit: false })).pdf);
    for (const page of pages) assert.notEqual(page.lines.at(-1), 'Experience', `${lines} lines: "Experience" ends a page`);
  }
});

test('a line break inside a field is a space, not glued words', async () => {
  const { text } = await readPdf(
    await renderAtsResumePdf(
      resume({
        work: [{ company: 'Globex', position: 'Engineer', startDate: '2020-01', summary: 'Owned the\r\nledger.', highlights: ['Built the ledger\nin Go'] }],
        projects: [{ name: 'Ledger', description: 'A double-entry ledger\nwritten in Go.' }],
      }),
    ),
  );
  for (const words of ['Owned the ledger.', 'Built the ledger in Go', 'A double-entry ledger written in Go.']) assert.ok(flat(text).includes(words), words);
});

test('characters the font lacks are replaced, so the text stays on the page', async () => {
  const pdf = await renderResumePdf(
    resume({
      basics: { ...resume().basics, name: '王小明', summary: '负责支付系统的设计与实现，'.repeat(12) },
      work: [{ company: 'Globex', position: 'Engineer', startDate: '2020-01', highlights: ['\uF0B7 Built the billing API', '● Led the launch 🚀'] }],
    }),
  );
  assert.ok(pdf.unsupported > 0);
  const { pages, text } = await readPdf(pdf.pdf);
  for (const page of pages) for (const item of page.items) assert.ok(item.x + item.width <= page.width - 28.8 + 0.5, `"${item.str.slice(0, 20)}" runs past the margin`);
  // A bullet character from a pasted résumé is dropped; our own bullet is drawn.
  assert.ok(flat(text).includes('• Built the billing API'), text);
  assert.ok(flat(text).includes('• Led the launch'), text);
  assert.ok(!text.includes('\u0000'));
});

test('links: only web and mail, valid URIs, and the rest is plain text', async () => {
  const { pages, text } = await readPdf(
    await renderAtsResumePdf(
      resume({
        basics: {
          ...resume().basics,
          url: 'javascript:alert(document.domain)',
          profiles: [
            { network: 'Site', url: 'https://łukasz.dev/' },
            { network: 'Wiki', url: 'https://example.com/a)b' },
            { network: 'Port', url: 'www.example.com:8080/x' },
            { network: 'File', url: 'file:///C:/secret.txt' },
          ],
        },
      }),
    ),
  );
  const links = pages[0]!.links.map((l) => l.replace(/\/$/, ''));
  assert.ok(links.includes('https://xn--ukasz-j7a.dev'), links.join(' '));
  assert.ok(links.includes('https://example.com/a)b'), links.join(' '));
  assert.ok(links.includes('https://www.example.com:8080/x'), links.join(' '));
  assert.ok(!links.some((l) => /^(javascript|file):/i.test(l)), links.join(' '));
  assert.ok(text.includes('łukasz.dev'));
});

test('a wide right-hand text gets its own line, and words are never split beside it', async () => {
  const url = `https://github.com/zoe/${'ledger-'.repeat(17)}x`;
  const { pages, text } = await readPdf(await renderAtsResumePdf(resume({ projects: [{ name: 'Ledger', url, highlights: ['Fast.'] }] })));
  for (const item of pages[0]!.items) {
    assert.ok(item.x >= 36 - 0.5, `"${item.str.slice(0, 20)}" starts off the page`);
    assert.ok(item.x + item.width <= pages[0]!.width - 36 + 0.5, `"${item.str.slice(0, 20)}" runs past the margin`);
  }
  assert.ok(pages[0]!.lines.some((line) => line === 'Ledger' || line.startsWith('Ledger ')), text);
});

test('a line breaks only at a space, even beside a bold number', async () => {
  const bullet = `${'word '.repeat(14)}${'x'.repeat(15)} (40%), then more text after it`;
  const { pages } = await readPdf(await renderAtsResumePdf(resume({ work: [{ company: 'Globex', position: 'Engineer', startDate: '2020-01', highlights: [bullet] }] })));
  assert.ok(!pages[0]!.lines.some((line) => line.startsWith('), then')), pages[0]!.lines.join('\n'));
});

test('the contact line wraps between items, never inside one or after a separator', async () => {
  const { pages } = await readPdf(
    await renderAtsResumePdf(
      resume({
        basics: {
          ...resume().basics,
          phone: '+1 (555) 014 2000',
          email: 'zoe.nunez.ramirez@example.com',
          location: { city: 'San Francisco', region: 'CA', countryCode: 'US' },
          url: 'https://zoe-nunez-ramirez.dev',
          profiles: [
            { network: 'LinkedIn', url: 'https://www.linkedin.com/in/zoe-nunez-ramirez-backend' },
            { network: 'GitHub', url: 'https://github.com/zoe-nunez-ramirez' },
          ],
        },
      }),
    ),
  );
  const contact = pages[0]!.lines.slice(2, 4);
  assert.equal(contact.length, 2);
  for (const line of contact) assert.ok(!/\|\s*$/.test(line) && !/^\s*\|/.test(line), line);
  assert.ok(contact.join(' ').includes('+1 (555) 014 2000') && contact.join(' ').includes('San Francisco, CA, US'));
});

test('a layout or a field as stored, not as typed, still renders', async () => {
  const raw = {
    ...resume(),
    layout: { sections: [null, { key: 'skills', hidden: 'false' }, { key: 'nope' }] },
    work: [{ company: 'Globex', position: 'Engineer', startDate: '2020-01', highlights: [42, null, 'Real bullet'] }],
  } as unknown as StructuredResume;
  const { text } = await readPdf(await renderAtsResumePdf(raw));
  assert.ok(text.includes('Skills'), 'a section hidden with "false" is not hidden');
  assert.ok(text.includes('42') && text.includes('Real bullet'));
});

test('bold numbers: results, not versions, years or a bare count before a word like "and"', async () => {
  const bullet = 'Grew to 10+ engineers and 1M+ users, 40%+ faster, $1.2M+ saved; ran Java 8+, Node 18+ and iOS 14+ since 2019+ with Python 3.11+ and v2.0+';
  const { pages } = await readPdf(await renderAtsResumePdf(resume({ work: [{ company: 'Globex', position: 'Engineer', startDate: '2020-01', highlights: [bullet] }] })));
  const bold = pages[0]!.items.filter((item) => /Bold/.test(item.font)).map((item) => item.str.trim());
  for (const metric of ['10+', '1M+', '40%+', '$1.2M+']) assert.ok(bold.includes(metric), `${metric} bold: ${bold.join(' | ')}`);
  for (const plain of ['8+', '18+', '14+', '2019+', '3.11+', '2.0+', '0+']) assert.ok(!bold.includes(plain), `${plain} not bold`);
});

test('a role summary that is a real sentence is kept, even with month-like words', async () => {
  const { text } = await readPdf(
    await renderAtsResumePdf(resume({ work: [{ company: 'Uniswap', position: 'Engineer', startDate: '2020-01', summary: 'Decentralized markets.', highlights: [] }] })),
  );
  assert.ok(text.includes('Decentralized markets.'));
});

test('a résumé bigger than any real one is refused before it is drawn', async () => {
  const sentence = 'Shipped a careful change to a busy service and measured it. '.repeat(80);
  const huge = resume({ work: Array.from({ length: 4 }, () => ({ company: 'Globex', position: 'Engineer', startDate: '2020-01', highlights: Array.from({ length: 20 }, () => sentence) })) });
  const start = Date.now();
  await assert.rejects(renderResumePdf(huge), ResumeTooLargeError);
  assert.ok(Date.now() - start < 1_000, `${Date.now() - start} ms`);
});

test('a leading sign is part of the claim; only a pasted bullet is dropped', async () => {
  const bullets = ['-40% p95 latency after the cache rewrite', '–30% cloud spend', '*nix fleet automation', '- Built the billing API', '•Shipped the ledger', '\uF0B7 Ran the migration'];
  const { text } = await readPdf(await renderAtsResumePdf(resume({ work: [{ company: 'Globex', position: 'Engineer', startDate: '2020-01', highlights: bullets }] })));
  const all = flat(text);
  for (const kept of ['• -40% p95 latency', '• –30% cloud spend', '• *nix fleet automation', '• Built the billing API', '• Shipped the ledger', '• Ran the migration']) {
    assert.ok(all.includes(kept), `${kept}\n${all}`);
  }
});

test('right-hand text gets the same care: no missing glyphs past the margin, no line breaks', async () => {
  const { pages } = await readPdf(
    await renderAtsResumePdf(resume({ work: [{ company: 'Globex', position: 'Engineer', location: '東京都 渋谷区\nRemote', startDate: '2018-01\n2019-01', highlights: ['Built it'] }] })),
  );
  for (const item of pages[0]!.items) {
    assert.ok(item.x + item.width <= pages[0]!.width - 28.8 + 0.5, `"${item.str}" runs past the margin`);
    assert.ok(!item.str.includes('\u0000'), 'a missing glyph');
  }
  const position = pages[0]!.lines.find((l) => l.startsWith('Engineer'));
  assert.ok(position && /Remote$/.test(position), `position line: ${position}`);
});

test('a non-breaking space is a place to break a line', async () => {
  const words = Array.from({ length: 40 }, (_, i) => `term${i}`);
  const bullet = words.join('\u00A0');
  const { pages } = await readPdf(await renderAtsResumePdf(resume({ work: [{ company: 'Globex', position: 'Engineer', startDate: '2020-01', highlights: [bullet] }] })));
  const lines = pages[0]!.lines.join(' ');
  for (const word of words) assert.ok(new RegExp(`(^|\\s)${word}(\\s|$)`).test(lines), `${word} broken: ${lines}`);
});

test('a version before a noun is not bold; a count after a verb is', async () => {
  const bullets = ['Built iOS 14+ apps and Java 17+ services', 'Managed 10+ engineers'];
  const { pages } = await readPdf(await renderAtsResumePdf(resume({ work: [{ company: 'Globex', position: 'Engineer', startDate: '2020-01', highlights: bullets }] })));
  const bold = pages[0]!.items.filter((item) => /Bold/.test(item.font)).map((item) => item.str.trim());
  assert.ok(!bold.includes('14+') && !bold.includes('17+'), bold.join(' | '));
  assert.ok(bold.includes('10+'), bold.join(' | '));
});
