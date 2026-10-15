import { PDFDocument } from 'pdf-lib';
import type { StructuredResume } from '@/types';
import { embedFonts, type Fonts } from '@/lib/pdf/fonts';
import { Flow, PAGE_SIZES, safeLink, type Run } from '@/lib/pdf/flow';
import { ResumeTooLargeError, resumeProblem } from '@/lib/input-caps';
import { resolveLayout, type ResolvedLayout } from '@/lib/resume-layout';

/**
 * The résumé PDF (#352), in the owner's reference look: the name centred in small caps, one
 * contact line with links, small-caps headings over a rule, "Company" with right-aligned
 * dates over the position in italics, and • bullets with their numbers in bold. One serif face,
 * real text (it extracts for applicant tracking systems), wrapped and paged.
 *
 * Fitted to one page when it can be: tighter spacing, then 0.4" margins, then 10 and 9.5 pt
 * text; never smaller, and nothing is dropped. A résumé that still needs two pages gets them
 * at the regular size.
 */

export { renderCoverLetterPdf } from '@/lib/cover-letter-pdf';
export type { CoverLetterPdfOptions } from '@/lib/cover-letter-pdf';

interface Step {
  spacing: number;
  margin: number;
  size: number;
}

const STEPS: Step[] = [
  { spacing: 1, margin: 36, size: 10.5 },
  { spacing: 0.85, margin: 36, size: 10.5 },
  { spacing: 0.7, margin: 36, size: 10.5 },
  { spacing: 0.7, margin: 28.8, size: 10.5 },
  { spacing: 0.7, margin: 28.8, size: 10 },
  { spacing: 0.7, margin: 28.8, size: 9.5 },
];

/** No text is smaller than this (the owner's floor), the contact line included. */
const MIN_SIZE = 9.5;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A stored field as text: a résumé saved by hand can hold numbers or nulls where text goes. */
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '');
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** "2026-05-01" → "May 2026"; "2019" stays; "present" → "Present"; anything else as written. */
export function humanDate(value: unknown): string {
  const text = str(value);
  const iso = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?(?:T.*)?$/.exec(text);
  if (iso && Number(iso[2]) >= 1 && Number(iso[2]) <= 12) return `${MONTHS[Number(iso[2]) - 1]} ${iso[1]}`;
  if (/^(present|current|now)$/i.test(text)) return 'Present';
  return text;
}

function dateRange(start: unknown, end: unknown, current?: unknown): string {
  const from = humanDate(start);
  const to = current === true ? 'Present' : humanDate(end) || (from ? 'Present' : '');
  return [from, to].filter(Boolean).join(' – ');
}

// Numbers that carry a result, bold: 40%, $1.2M, 3×, 10k, 1M+, and a count of 10 or more before
// a noun ("10+ engineers"). Not years, versions ("Java 8+", "Python 3.11+", "Node 18+ and") or
// plain counts. Every number is matched from its first digit, so the scan stays linear.
const METRIC = new RegExp(
  [
    String.raw`[$€£]\s?\d+(?:,\d{3})*(?:\.\d+)?(?:\s?(?:[kKmMbB]|million|billion)\b)?\+?`,
    String.raw`(?<![\w.])\d+(?:,\d{3})*(?:\.\d+)?(?:\s?%|\s?×|x\b|[kKmM]\b)\+?`,
    String.raw`(?<![\w.$])(?:[1-9]\d{1,2}|\d{1,3}(?:,\d{3})+)\+(?=\s+(?!(?:and|or|since|with|to|in|on|at|of|for|the|a|an)\b)[a-z])`,
  ].join('|'),
  'g',
);

// A bare count ("14+") after a product name is a version ("iOS 14+ apps", "Java 17+
// services"): the word before it has a capital, and isn't the bullet's first word (a verb).
const BARE_COUNT = /^[\d,]+\+$/;
const versionLike = (text: string, index: number) => {
  const before = text.slice(0, index).trimEnd().split(/\s+/);
  return before.length > 1 && /[A-Z]/.test(before[before.length - 1]!);
};

function withMetrics(text: string, size: number): Run[] {
  const runs: Run[] = [];
  let at = 0;
  for (const match of text.matchAll(METRIC)) {
    if (BARE_COUNT.test(match[0]) && versionLike(text, match.index!)) continue;
    if (match.index! > at) runs.push({ text: text.slice(at, match.index), font: 'regular', size });
    runs.push({ text: match[0], font: 'bold', size });
    at = match.index! + match[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at), font: 'regular', size });
  return runs;
}

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

const MONTH_WORDS = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?|present|current|now)\b|\d+/g;

/** A role summary that only repeats the role's header (the parse sometimes puts it there). */
function repeatsHeader(summary: string, parts: string[]): boolean {
  let rest = ` ${norm(summary)} `;
  for (const part of parts) if (part) rest = rest.split(norm(part)).join(' ');
  rest = rest.replace(MONTH_WORDS, ' ').replace(/[^\p{L}]+/gu, ' ');
  return rest.trim().split(' ').filter((word) => word.length > 1).length === 0;
}

// A bullet pasted with the text (from Word, a PDF, a website): we draw our own. A dash or "*"
// only with a space after it, so "-40% latency" and "*nix" keep their first character.
const PASTED_BULLET = /^(?:[\uF0B7\uF0A7\u2022\u25CF\u25AA\u25A0\u25C6\u25E6\u2023\u2043\u00B7]\s*|[-*\u2013\u2014]\s+)/;

/** "https://www.linkedin.com/in/zoe/" → "linkedin.com/in/zoe". */
const shortUrl = (url: string) => url.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');

function layoutResume(resume: StructuredResume, layout: ResolvedLayout, fonts: Fonts, step: Step): Flow {
  const { spacing, margin, size } = step;
  const flow = new Flow(fonts, { ...PAGE_SIZES[layout.pageSize], margin });
  const small = Math.max(MIN_SIZE, size - 0.5);
  const basics = (resume.basics ?? {}) as unknown as Record<string, unknown>;
  const line = size * 1.2;
  const linked = (text: string, url: string, at = small): Run => {
    const link = safeLink(url);
    return { text, font: 'regular', size: at, ...(link ? { link } : {}) };
  };

  flow.write([{ text: str(basics.name) || 'Résumé', font: 'boldCaps', size: size * 2.2 }], { align: 'center' });
  if (str(basics.label)) flow.write([{ text: str(basics.label), font: 'italic', size }], { align: 'center' });
  const contact: Run[][] = [];
  if (str(basics.phone)) contact.push([{ text: str(basics.phone), font: 'regular', size: small }]);
  if (str(basics.email)) contact.push([linked(str(basics.email), `mailto:${str(basics.email)}`)]);
  const location = (basics.location ?? {}) as Record<string, unknown>;
  const place = [location.city, location.region, location.countryCode].map(str).filter(Boolean).join(', ');
  if (place) contact.push([{ text: place, font: 'regular', size: small }]);
  for (const url of [basics.url, ...list(basics.profiles).map((p) => (p as Record<string, unknown> | null)?.url)].map(str)) {
    if (url) contact.push([linked(shortUrl(url), url)]);
  }
  if (contact.length > 0) flow.items(contact, { text: '  |  ', font: 'regular', size: small });

  /** A heading, with room kept below it for the first `lines` of its section. */
  const heading = (title: string, lines: number) => {
    flow.space(8 * spacing);
    flow.need(size * 1.25 * 1.2 + 3 * spacing + lines * line + 1);
    flow.write([{ text: title, font: 'caps', size: size * 1.25 }]);
    flow.rule(2.5);
    flow.space(3 * spacing);
  };
  const bullets = (items: unknown) => {
    for (const item of list(items).map(str)) {
      const text = item.replace(PASTED_BULLET, '');
      if (text) flow.write(withMetrics(text, size), { indent: 8, hang: 10, marker: { text: '•', font: 'regular', size } });
    }
  };
  const entryGap = () => flow.space(4 * spacing);
  const records = (value: unknown) => list(value).filter((v): v is Record<string, unknown> => Boolean(v && typeof v === 'object'));

  for (const section of layout.sections) {
    switch (section.key) {
      case 'summary': {
        const paragraphs = str(basics.summary).split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);
        if (paragraphs.length === 0) break;
        heading(section.title, 1);
        for (const paragraph of paragraphs) flow.write([{ text: paragraph, font: 'regular', size }]);
        break;
      }
      case 'work': {
        const roles = records(resume.work).filter((role) => str(role.company) || str(role.position));
        if (roles.length === 0) break;
        heading(section.title, 3);
        roles.forEach((role, i) => {
          if (i > 0) entryGap();
          const company = str(role.company);
          const position = str(role.position);
          flow.need(line * 3);
          flow.write([{ text: company || position, font: 'bold', size }], {
            right: [{ text: dateRange(role.startDate, role.endDate, role.current), font: 'regular', size }],
          });
          if (company && position) {
            flow.write([{ text: position, font: 'italic', size }], {
              right: str(role.location) ? [{ text: str(role.location), font: 'italic', size }] : [],
            });
          }
          const summary = str(role.summary);
          if (summary && !repeatsHeader(summary, [company, position, str(role.location)])) flow.write([{ text: summary, font: 'regular', size }]);
          bullets(role.highlights);
        });
        break;
      }
      case 'education': {
        const schools = records(resume.education).filter((school) => str(school.institution));
        if (schools.length === 0) break;
        heading(section.title, 2);
        schools.forEach((school, i) => {
          if (i > 0) entryGap();
          const dates = str(school.startDate) ? dateRange(school.startDate, school.endDate) : humanDate(school.endDate);
          flow.write([{ text: str(school.institution), font: 'bold', size }], { right: dates ? [{ text: dates, font: 'regular', size }] : [] });
          const degree = [str(school.studyType), str(school.area)].filter(Boolean).join(', ');
          const detail = [degree, str(school.gpa) ? `GPA ${str(school.gpa)}` : ''].filter(Boolean).join(' · ');
          if (detail) flow.write([{ text: detail, font: 'italic', size }]);
          bullets(school.highlights);
        });
        break;
      }
      case 'skills': {
        const groups = records(resume.skills)
          .map((group) => ({ category: str(group.category), skills: list(group.skills).map(str).filter(Boolean) }))
          .filter((group) => group.skills.length > 0);
        if (groups.length === 0) break;
        heading(section.title, 1);
        for (const group of groups) {
          flow.write([
            ...(group.category ? [{ text: `${group.category}: `, font: 'bold' as const, size }] : []),
            { text: group.skills.join(', '), font: 'regular', size },
          ]);
        }
        break;
      }
      case 'projects': {
        const projects = records(resume.projects).filter((project) => str(project.name));
        if (projects.length === 0) break;
        heading(section.title, 2);
        projects.forEach((project, i) => {
          if (i > 0) entryGap();
          const keywords = list(project.keywords).map(str).filter(Boolean).join(', ');
          const url = str(project.url);
          flow.write(
            [{ text: str(project.name), font: 'bold', size }, ...(keywords ? [{ text: ` | ${keywords}`, font: 'italic' as const, size }] : [])],
            { right: url ? [linked(shortUrl(url), url)] : [] },
          );
          const highlights = list(project.highlights).map(str).filter(Boolean);
          const description = str(project.description);
          // The parse sometimes puts the same sentence in both.
          if (description && !highlights.some((h) => norm(h) === norm(description))) flow.write([{ text: description, font: 'regular', size }]);
          bullets(highlights);
        });
        break;
      }
      case 'certificates': {
        const certificates = records(resume.certificates).filter((c) => str(c.name));
        if (certificates.length === 0) break;
        heading(section.title, 1);
        for (const certificate of certificates) {
          const issuer = str(certificate.issuer);
          const link = safeLink(str(certificate.url));
          flow.write(
            [
              { text: str(certificate.name), font: 'bold', size, ...(str(certificate.url) && link ? { link } : {}) },
              ...(issuer ? [{ text: ` — ${issuer}`, font: 'regular' as const, size }] : []),
            ],
            { right: str(certificate.date) ? [{ text: humanDate(certificate.date), font: 'regular', size }] : [] },
          );
        }
        break;
      }
    }
  }
  return flow;
}

export interface ResumePdf {
  pdf: Buffer;
  pages: number;
  /** Characters the font has no glyph for (CJK, emoji), printed as "?". */
  unsupported: number;
}

export async function renderResumePdf(resume: StructuredResume, options: { fit?: boolean } = {}): Promise<ResumePdf> {
  // Drawn on the request: one bigger than any real résumé (saved before the caps, say) is refused,
  // by every cap a save checks: a field, a list, and the text in all.
  const tooLarge = resumeProblem(resume);
  if (tooLarge) throw new ResumeTooLargeError(tooLarge);
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);
  const layout = resolveLayout(resume);
  let flow = layoutResume(resume, layout, fonts, STEPS[0]!);
  // Fitting only ever saves a page's worth: past two pages it can't reach one.
  if (options.fit !== false && flow.pages === 2) {
    for (const step of STEPS.slice(1)) {
      const tighter = layoutResume(resume, layout, fonts, step);
      if (tighter.pages === 1) {
        flow = tighter;
        break;
      }
    }
  }
  flow.draw(doc);
  const name = str(resume.basics?.name) || 'Résumé';
  doc.setTitle(`${name} – Résumé`);
  doc.setAuthor(name);
  doc.setCreator('JobOps Copilot');
  doc.setProducer('JobOps Copilot');
  // Classic cross-reference tables: every reader, old parsers included, opens them.
  return { pdf: Buffer.from(await doc.save({ useObjectStreams: false })), pages: flow.pages, unsupported: flow.unsupported };
}

export async function renderAtsResumePdf(resume: StructuredResume): Promise<Buffer> {
  return (await renderResumePdf(resume)).pdf;
}
