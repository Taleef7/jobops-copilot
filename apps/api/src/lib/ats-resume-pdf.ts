/**
 * Deterministic, ATS-safe single-column resume PDF generator.
 *
 * Produces valid, standard PDF 1.4 binary data with clean text objects (/Tj, /TJ),
 * standard typography (Helvetica), and structured single-column flow that ATS
 * parsers easily ingest without bounding-box confusion.
 */
import type { StructuredResume } from '@/types';

function escapePdfString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

interface TextItem {
  text: string;
  size: number;
  bold?: boolean;
  indent?: number;
  gapBefore?: number;
}

/**
 * Renders a structured resume into ATS-compliant PDF buffer.
 * Standard Letter size (612 x 792 pt), 0.5 inch (36 pt) margins, single column.
 */
export function renderAtsResumePdf(resume: StructuredResume): Buffer {
  const items: TextItem[] = [];

  // Basics: Name, Title, Contact, Summary
  const basics = resume.basics || { name: 'Candidate', email: '', summary: '' };
  items.push({ text: basics.name, size: 20, bold: true, gapBefore: 0 });

  if (basics.label) {
    items.push({ text: basics.label, size: 12, bold: true, gapBefore: 4 });
  }

  const contactParts: string[] = [];
  if (basics.email) contactParts.push(basics.email);
  if (basics.phone) contactParts.push(basics.phone);
  if (basics.url) contactParts.push(basics.url);
  if (basics.location?.city) {
    const loc = [basics.location.city, basics.location.region, basics.location.countryCode]
      .filter(Boolean)
      .join(', ');
    contactParts.push(loc);
  }

  if (contactParts.length > 0) {
    items.push({ text: contactParts.join(' | '), size: 10, gapBefore: 4 });
  }

  if (basics.summary) {
    items.push({ text: 'PROFESSIONAL SUMMARY', size: 11, bold: true, gapBefore: 12 });
    items.push({ text: basics.summary, size: 10, gapBefore: 4 });
  }

  // Work Experience
  if (resume.work && resume.work.length > 0) {
    items.push({ text: 'WORK EXPERIENCE', size: 11, bold: true, gapBefore: 12 });
    for (const exp of resume.work) {
      const dates = [exp.startDate, exp.current ? 'Present' : exp.endDate].filter(Boolean).join(' - ');
      const titleLine = [exp.position, exp.company].filter(Boolean).join(' - ');
      const fullLine = dates ? `${titleLine} (${dates})` : titleLine;
      items.push({ text: fullLine, size: 10, bold: true, gapBefore: 6 });
      if (exp.summary) {
        items.push({ text: exp.summary, size: 9.5, gapBefore: 2 });
      }
      for (const hl of exp.highlights || []) {
        items.push({ text: `* ${hl}`, size: 9.5, indent: 10, gapBefore: 2 });
      }
    }
  }

  // Education
  if (resume.education && resume.education.length > 0) {
    items.push({ text: 'EDUCATION', size: 11, bold: true, gapBefore: 12 });
    for (const edu of resume.education) {
      const degree = [edu.studyType, edu.area].filter(Boolean).join(' in ');
      const dateStr = edu.endDate ? ` (${edu.endDate})` : '';
      const line = `${degree ? `${degree} - ` : ''}${edu.institution}${dateStr}`;
      items.push({ text: line, size: 10, bold: true, gapBefore: 4 });
      for (const hl of edu.highlights || []) {
        items.push({ text: `* ${hl}`, size: 9.5, indent: 10, gapBefore: 2 });
      }
    }
  }

  // Skills
  if (resume.skills && resume.skills.length > 0) {
    items.push({ text: 'SKILLS', size: 11, bold: true, gapBefore: 12 });
    for (const s of resume.skills) {
      const line = `${s.category}: ${(s.skills || []).join(', ')}`;
      items.push({ text: line, size: 10, gapBefore: 3 });
    }
  }

  // Projects
  if (resume.projects && resume.projects.length > 0) {
    items.push({ text: 'PROJECTS', size: 11, bold: true, gapBefore: 12 });
    for (const p of resume.projects) {
      const urlStr = p.url ? ` (${p.url})` : '';
      items.push({ text: `${p.name}${urlStr}`, size: 10, bold: true, gapBefore: 4 });
      if (p.description) {
        items.push({ text: p.description, size: 9.5, gapBefore: 2 });
      }
      for (const hl of p.highlights || []) {
        items.push({ text: `* ${hl}`, size: 9.5, indent: 10, gapBefore: 2 });
      }
    }
  }

  // Certificates
  if (resume.certificates && resume.certificates.length > 0) {
    items.push({ text: 'CERTIFICATIONS', size: 11, bold: true, gapBefore: 12 });
    for (const c of resume.certificates) {
      const dateStr = c.date ? ` (${c.date})` : '';
      items.push({ text: `${c.name} - ${c.issuer}${dateStr}`, size: 10, gapBefore: 3 });
    }
  }

  // Build PDF document content stream
  // Letter size: 612 x 792 pt
  const startX = 36;
  let currentY = 756; // 792 - 36 margin
  const streamOps: string[] = [];

  for (const item of items) {
    currentY -= (item.gapBefore ?? 0) + item.size;
    const fontName = item.bold ? '/F2' : '/F1';
    const xPos = startX + (item.indent ?? 0);
    const escaped = escapePdfString(item.text);

    streamOps.push(
      'BT',
      `${fontName} ${item.size} Tf`,
      `1 0 0 1 ${xPos} ${currentY} Tm`,
      `(${escaped}) Tj`,
      'ET',
    );
  }

  const streamContent = streamOps.join('\n');
  const streamLength = Buffer.byteLength(streamContent);

  // Construct standard PDF 1.4 objects
  const objects: string[] = [
    // 1: Catalog
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    // 2: Pages
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    // 3: Page
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj`,
    // 4: Contents
    `4 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream\nendobj`,
    // 5: Helvetica Normal
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj',
    // 6: Helvetica Bold
    '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj',
  ];

  // Assemble PDF with exact cross-reference table
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0]; // obj 0 offset is always 0

  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${obj}\n`;
  }

  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    const off = offsets[i]!;
    pdf += `${off.toString().padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf-8');
}
