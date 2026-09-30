import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPdfText } from '@/lib/pdf-text';
import { buildPdfFromRuns, helveticaWidth } from '@/test-support/pdf-fixtures';

/**
 * #350: text drawn as separate runs keeps the space the gap between them stands for. The
 * old reader glued "Encoded" + bold "9" + "regulatory" into "Encoded9 regulatory", and the
 * résumé parse then took "Encoded9" for an employer.
 */

// A gap about the width of a space at 11 pt.
const SPACE = 3.1;

test('a bold number inside a sentence keeps its spaces', async () => {
  const encoded = 90 + helveticaWidth('Encoded') + SPACE;
  const { text } = await extractPdfText(
    buildPdfFromRuns([
      [
        { text: 'Encoded', x: 90 },
        { text: '9', x: encoded, bold: true },
        { text: 'regulatory measures as documented business rules', x: encoded + 7 + SPACE },
      ],
    ]),
  );
  assert.match(text, /Encoded 9 regulatory measures as documented business rules/);
});

test('a word split into runs with no gap stays one word', async () => {
  const { text } = await extractPdfText(
    buildPdfFromRuns([[{ text: 'Reg', x: 90 }, { text: 'ulatory', x: 90 + helveticaWidth('Reg') }]]),
  );
  assert.match(text, /\bRegulatory\b/);
});

test('a role header keeps the company apart from its dates, and each line on its own line', async () => {
  const { text } = await extractPdfText(
    buildPdfFromRuns([
      [
        { text: 'Medical Informatics Engineering', x: 72, bold: true },
        { text: 'May 2026 – Present', x: 460 },
      ],
      [{ text: 'Software Developer', x: 72 }],
      [
        { text: '•', x: 80 },
        { text: 'Riccle', x: 90, bold: true },
        { text: '(early-stage e-commerce startup)', x: 90 + 40 },
      ],
    ]),
  );
  const lines = text.split('\n').map((line) => line.trim());
  assert.ok(lines.includes('Medical Informatics Engineering May 2026 – Present'), JSON.stringify(lines));
  assert.ok(lines.includes('Software Developer'), JSON.stringify(lines));
  assert.ok(lines.some((line) => line.endsWith('Riccle (early-stage e-commerce startup)')), JSON.stringify(lines));
});
