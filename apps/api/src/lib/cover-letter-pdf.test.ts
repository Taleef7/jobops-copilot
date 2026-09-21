import assert from 'node:assert/strict';
import test from 'node:test';
import { renderCoverLetterPdf } from './cover-letter-pdf';

test('renderCoverLetterPdf generates valid PDF 1.4 binary', () => {
  const pdfBuffer = renderCoverLetterPdf({
    candidateName: 'Jane Developer',
    candidateEmail: 'jane@example.com',
    candidatePhone: '+1-555-0100',
    candidateLocation: 'San Francisco, CA',
    recipientName: 'Sarah Connor',
    recipientRole: 'Engineering Director',
    companyName: 'Cyberdyne Systems',
    subject: 'Staff Automation Engineer',
    bodyText:
      'I am writing to express my enthusiastic interest in the Staff Automation Engineer role at Cyberdyne Systems.\n\n' +
      'With over eight years of experience building resilient distributed backends and event-driven architectures in TypeScript and Python, ' +
      'I have consistently delivered high-throughput systems that reduce operational overhead.\n\n' +
      'Thank you for your time and consideration. I look forward to speaking with you.',
  });

  assert(Buffer.isBuffer(pdfBuffer));
  assert(pdfBuffer.length > 500);

  const pdfString = pdfBuffer.toString('utf-8');
  assert(pdfString.startsWith('%PDF-1.4'));
  assert(pdfString.includes('%%EOF'));
  assert(pdfString.includes('Jane Developer'));
  assert(pdfString.includes('Cyberdyne Systems'));
  assert(pdfString.includes('Staff Automation Engineer'));
});
