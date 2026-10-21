import assert from 'node:assert/strict';
import test from 'node:test';
import { renderCoverLetterPdf } from './cover-letter-pdf';
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

test('six paragraphs of 120 words run onto a second page, intact', async () => {
  // Ordinary prose: 120 words of everyday length, each paragraph marked so it can be found.
  const prose = 'I have built and run payment systems for teams that care about the details and the people who use them'.split(' ');
  const paragraphs = Array.from({ length: 6 }, (_, p) => [`Paragraph${p}`, ...Array.from({ length: 119 }, (_, w) => prose[w % prose.length])].join(' '));
  const { pages } = await readPdf(await renderCoverLetterPdf({ ...letter, bodyText: paragraphs.join('\n\n') }));
  assert.equal(pages.length, 2);
  const all = flat(pages.flatMap((page) => page.lines).join(' '));
  for (const paragraph of paragraphs) assert.ok(all.includes(paragraph), paragraph.slice(0, 20));
  for (const page of pages) {
    for (const item of page.items) assert.ok(item.x + item.width <= page.width - 72 + 0.5, `"${item.str}" runs past the margin`);
  }
});
