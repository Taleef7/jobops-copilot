import assert from 'node:assert/strict';
import test from 'node:test';
import { renderCoverLetter, renderCoverLetterPdf } from './cover-letter-pdf';
import { MAX_LETTER_CHARS, MAX_LETTER_WORDS, MAX_PARAGRAPHS } from './cover-letter/limits';
import { flat, readPdf } from '@/test-support/pdf-read';

/** The cover letter PDF (#352): the résumé's writer, so wrapped, paged and Unicode. */

const letter = {
  candidateName: 'Zoë Núñez',
  candidateEmail: 'zoe@example.com',
  candidatePhone: '+1-555-0100',
  candidateLocation: 'San Francisco, CA',
  recipientName: 'Sarah Connor',
  recipientRole: 'Engineering Director',
  companyName: 'Cyberdyne Systems',
  subject: 'Staff Automation Engineer',
  date: 'October 15, 2026',
};

test('a short letter is one page with its letterhead and text', async () => {
  const bodyText = 'I am writing about the Staff Automation Engineer role.\n\nThank you for your time.';
  const { pages, text } = await readPdf(await renderCoverLetterPdf({ ...letter, bodyText }));
  assert.equal(pages.length, 1);
  for (const part of ['Zoë Núñez', 'zoe@example.com', 'October 15, 2026', 'Sarah Connor', 'Cyberdyne Systems', 'Staff Automation Engineer', 'Thank you for your time.']) {
    assert.ok(text.includes(part), part);
  }
});

test('unfitted, six paragraphs of 120 words run onto a second page, intact', async () => {
  // Ordinary prose: 120 words of everyday length, each paragraph marked so it can be found.
  const prose = 'I have built and run payment systems for teams that care about the details and the people who use them'.split(' ');
  const paragraphs = Array.from({ length: 6 }, (_, p) => [`Paragraph${p}`, ...Array.from({ length: 119 }, (_, w) => prose[w % prose.length])].join(' '));
  const unfitted = await renderCoverLetter({ ...letter, bodyText: paragraphs.join('\n\n') }, { fit: false });
  const { pages } = await readPdf(unfitted.pdf);
  assert.equal(pages.length, 2);
  const all = flat(pages.flatMap((page) => page.lines).join(' '));
  for (const paragraph of paragraphs) assert.ok(all.includes(paragraph), paragraph.slice(0, 20));
  for (const page of pages) {
    for (const item of page.items) assert.ok(item.x + item.width <= page.width - 72 + 0.5, `"${item.str}" runs past the margin`);
  }
});

/**
 * Always one page (#416): a letter that runs past one page at the regular look is fitted:
 * tighter spacing, then 0.75" margins, then smaller text down to 10 pt. Nothing is cut.
 */

/** Ordinary prose of `words` words in `count` paragraphs, each marked so it can be found. */
function proseOf(words: number, count: number): string[] {
  const pool = 'I have built and run payment systems for teams that care about the details and the people who use them'.split(' ');
  const per = Math.floor(words / count);
  return Array.from({ length: count }, (_, p) => [`Paragraph${p}`, ...Array.from({ length: per - 1 }, (_, w) => pool[w % pool.length])].join(' '));
}

const greetingAndClosing = (paragraphs: string[]) =>
  ['Dear Cyberdyne Systems hiring team,', ...paragraphs, 'Sincerely,\nZoë Núñez'].join('\n\n');

test('a Full letter that runs past one page at the regular size is fitted onto one, every word intact', async () => {
  const paragraphs = proseOf(560, 5);
  const options = { ...letter, bodyText: greetingAndClosing(paragraphs) };
  assert.equal((await renderCoverLetter(options, { fit: false })).pages, 2, 'the test letter needs fitting');

  const fitted = await renderCoverLetter(options);
  assert.equal(fitted.pages, 1);
  const { pages } = await readPdf(fitted.pdf);
  assert.equal(pages.length, 1);
  const all = flat(pages[0]!.lines.join(' '));
  for (const paragraph of paragraphs) assert.ok(all.includes(paragraph), paragraph.slice(0, 20));
  assert.ok(all.includes('Sincerely, Zoë Núñez'), all.slice(-80));
  // Never smaller than 10 pt for the letter, 9.5 pt for the contact line.
  const body = pages[0]!.items.filter((item) => item.str.includes('Paragraph'));
  assert.ok(body.length > 0);
  for (const item of body) assert.ok(item.size >= 9.99, `"${item.str}" at ${item.size} pt`);
  for (const item of pages[0]!.items) assert.ok(item.size >= 9.49, `"${item.str}" at ${item.size} pt`);
});

test('a letter that fits at the regular size keeps it', async () => {
  const fitted = await renderCoverLetter({ ...letter, bodyText: greetingAndClosing(proseOf(180, 3)) });
  assert.equal(fitted.pages, 1);
  assert.equal(fitted.size, 11);
});

test('the longest letter the API accepts fits on one page, at 10 pt or more', async () => {
  // At every cap at once: the most words, made of long words up to the character cap, in the
  // most paragraphs, under a long name, contact line, company and title.
  const cycle = ['responsibilities', 'and', 'infrastructure', 'to'];
  const words: string[] = [];
  while ([...words, cycle[words.length % cycle.length]].join(' ').length <= MAX_LETTER_CHARS) words.push(cycle[words.length % cycle.length]!);
  assert.ok(words.length <= MAX_LETTER_WORDS, `${words.length} words is over the cap: not a letter the API accepts`);
  const per = Math.ceil(words.length / MAX_PARAGRAPHS);
  const paragraphs = Array.from({ length: MAX_PARAGRAPHS }, (_, p) => words.slice(p * per, (p + 1) * per).join(' ')).filter(Boolean);
  assert.equal(paragraphs.length, MAX_PARAGRAPHS);
  const fitted = await renderCoverLetter({
    ...letter,
    candidateName: 'Maximiliana Alexandra Wolfeschlegelsteinhausen',
    candidateEmail: 'maximiliana.wolfeschlegelsteinhausen@example-university.edu',
    candidateLocation: 'Rancho Santa Margarita, California',
    companyName: 'International Business Machines Corporation of North America',
    subject: 'Principal Distributed Systems and Infrastructure Reliability Engineer',
    bodyText: greetingAndClosing(paragraphs),
  });
  assert.equal(fitted.pages, 1);
  assert.ok(fitted.size >= 10);
  const { pages } = await readPdf(fitted.pdf);
  assert.equal(pages.length, 1);
});

test('a letter too long for one page even at 10 pt is paged at the regular look, never cut', async () => {
  const paragraphs = proseOf(1_500, 12);
  const rendered = await renderCoverLetter({ ...letter, bodyText: greetingAndClosing(paragraphs) });
  assert.ok(rendered.pages >= 2);
  assert.equal(rendered.size, 11);
  const { pages } = await readPdf(rendered.pdf);
  const all = flat(pages.flatMap((page) => page.lines).join(' '));
  for (const paragraph of paragraphs) assert.ok(all.includes(paragraph), paragraph.slice(0, 20));
});

test('renderCoverLetterPdf is the fitted letter', async () => {
  const bodyText = greetingAndClosing(proseOf(560, 5));
  const { pages } = await readPdf(await renderCoverLetterPdf({ ...letter, bodyText }));
  assert.equal(pages.length, 1);
});
