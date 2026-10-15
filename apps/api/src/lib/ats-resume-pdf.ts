import { PDFDocument } from 'pdf-lib';
import type { ResumeWorkExperience, StructuredResume } from '@/types';
import { embedFonts, type Fonts } from '@/lib/pdf/fonts';
import { Flow, PAGE_SIZES, type Run } from '@/lib/pdf/flow';
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-05-01" → "May 2026"; "2019" stays; "present" → "Present"; anything else as written. */
export function humanDate(value: string | undefined): string {
  const text = value?.trim() ?? '';
  const iso = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?(?:T.*)?$/.exec(text);
  if (iso && Number(iso[2]) >= 1 && Number(iso[2]) <= 12) return `${MONTHS[Number(iso[2]) - 1]} ${iso[1]}`;
  if (/^(present|current|now)$/i.test(text)) return 'Present';
  return text;
}

function dateRange(start?: string, end?: string, current?: boolean): string {
  const from = humanDate(start);
  const to = current ? 'Present' : humanDate(end) || (from ? 'Present' : '');
  return [from, to].filter(Boolean).join(' – ');
}

// Numbers that carry a result: 40%, $1.2M, 3×, 10k, 10+. Not years, versions or plain counts.
const METRIC = /(?:[$€£]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:[kKmMbB]|million|billion)\b)?\+?|\b\d[\d,]*(?:\.\d+)?(?:\s?%|\s?×|x\b|[kKmM]\b|\+))/g;

function withMetrics(text: string, size: number): Run[] {
  const runs: Run[] = [];
  let at = 0;
  for (const match of text.matchAll(METRIC)) {
    if (match.index! > at) runs.push({ text: text.slice(at, match.index), font: 'regular', size });
    runs.push({ text: match[0], font: 'bold', size });
    at = match.index! + match[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at), font: 'regular', size });
  return runs;
}

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** A role summary that only repeats the role's header (the parse sometimes puts it there). */
function repeatsHeader(summary: string, role: ResumeWorkExperience): boolean {
  let rest = ` ${norm(summary)} `;
  for (const part of [role.company, role.position, role.location]) if (part?.trim()) rest = rest.split(norm(part)).join(' ');
  rest = rest
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b(present|current|now)\b|\d+/g, ' ')
    .replace(/[^\p{L}]+/gu, ' ');
  return rest.trim().split(' ').filter((word) => word.length > 1).length === 0;
}

/** "https://www.linkedin.com/in/zoe/" → "linkedin.com/in/zoe". */
const shortUrl = (url: string) => url.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
const href = (url: string) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);

function layoutResume(resume: StructuredResume, layout: ResolvedLayout, fonts: Fonts, step: Step): Flow {
  const { spacing, margin, size } = step;
  const flow = new Flow(fonts, { ...PAGE_SIZES[layout.pageSize], margin });
  const small = size - 0.5;
  const basics = resume.basics;

  flow.write([{ text: basics.name?.trim() || 'Résumé', font: 'boldCaps', size: size * 2.2 }], { center: true });
  if (basics.label?.trim()) flow.write([{ text: basics.label.trim(), font: 'italic', size }], { center: true });
  const contact: Run[][] = [];
  if (basics.phone?.trim()) contact.push([{ text: basics.phone.trim(), font: 'regular', size: small }]);
  if (basics.email?.trim()) contact.push([{ text: basics.email.trim(), font: 'regular', size: small, link: `mailto:${basics.email.trim()}` }]);
  const place = [basics.location?.city, basics.location?.region, basics.location?.countryCode].filter((part) => part?.trim()).join(', ');
  if (place) contact.push([{ text: place, font: 'regular', size: small }]);
  for (const url of [basics.url, ...(basics.profiles ?? []).map((profile) => profile.url)]) {
    if (url?.trim()) contact.push([{ text: shortUrl(url.trim()), font: 'regular', size: small, link: href(url.trim()) }]);
  }
  if (contact.length > 0) {
    flow.write(contact.flatMap((item, i) => (i === 0 ? item : [{ text: '  |  ', font: 'regular' as const, size: small }, ...item])), { center: true });
  }

  const heading = (title: string) => {
    flow.space(8 * spacing);
    // Never alone at the bottom of a page: keep room for its first line.
    flow.need(size * 1.25 * 1.2 + size * 1.2 * 2);
    flow.write([{ text: title, font: 'caps', size: size * 1.25 }]);
    flow.rule(2.5);
    flow.space(3 * spacing);
  };
  const bullets = (items: string[] | undefined) => {
    for (const item of items ?? []) {
      if (!item?.trim()) continue;
      flow.write(withMetrics(item.trim(), size), { indent: 8, hang: 10, marker: { text: '•', font: 'regular', size } });
    }
  };
  const entryGap = () => flow.space(4 * spacing);

  for (const section of layout.sections) {
    switch (section.key) {
      case 'summary': {
        const paragraphs = (basics.summary ?? '').split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);
        if (paragraphs.length === 0) break;
        heading(section.title);
        for (const paragraph of paragraphs) flow.write([{ text: paragraph, font: 'regular', size }]);
        break;
      }
      case 'work': {
        const roles = (resume.work ?? []).filter((role) => role.company?.trim() || role.position?.trim());
        if (roles.length === 0) break;
        heading(section.title);
        roles.forEach((role, i) => {
          if (i > 0) entryGap();
          flow.need(size * 1.2 * 3);
          flow.write([{ text: role.company?.trim() || role.position.trim(), font: 'bold', size }], {
            right: [{ text: dateRange(role.startDate, role.endDate, role.current), font: 'regular', size }],
          });
          if (role.company?.trim() && role.position?.trim()) {
            flow.write([{ text: role.position.trim(), font: 'italic', size }], {
              right: role.location?.trim() ? [{ text: role.location.trim(), font: 'italic', size }] : [],
            });
          }
          if (role.summary?.trim() && !repeatsHeader(role.summary, role)) flow.write([{ text: role.summary.trim(), font: 'regular', size }]);
          bullets(role.highlights);
        });
        break;
      }
      case 'education': {
        const schools = (resume.education ?? []).filter((school) => school.institution?.trim());
        if (schools.length === 0) break;
        heading(section.title);
        schools.forEach((school, i) => {
          if (i > 0) entryGap();
          const dates = school.startDate ? dateRange(school.startDate, school.endDate) : humanDate(school.endDate);
          flow.write([{ text: school.institution.trim(), font: 'bold', size }], { right: dates ? [{ text: dates, font: 'regular', size }] : [] });
          const degree = [school.studyType?.trim(), school.area?.trim()].filter(Boolean).join(', ');
          const detail = [degree, school.gpa?.trim() ? `GPA ${school.gpa.trim()}` : ''].filter(Boolean).join(' · ');
          if (detail) flow.write([{ text: detail, font: 'italic', size }]);
          bullets(school.highlights);
        });
        break;
      }
      case 'skills': {
        const groups = (resume.skills ?? []).filter((group) => group.skills?.some((skill) => skill?.trim()));
        if (groups.length === 0) break;
        heading(section.title);
        for (const group of groups) {
          const list = group.skills.map((skill) => skill.trim()).filter(Boolean).join(', ');
          flow.write([...(group.category?.trim() ? [{ text: `${group.category.trim()}: `, font: 'bold' as const, size }] : []), { text: list, font: 'regular', size }]);
        }
        break;
      }
      case 'projects': {
        const projects = (resume.projects ?? []).filter((project) => project.name?.trim());
        if (projects.length === 0) break;
        heading(section.title);
        projects.forEach((project, i) => {
          if (i > 0) entryGap();
          const keywords = (project.keywords ?? []).map((k) => k.trim()).filter(Boolean).join(', ');
          flow.write(
            [
              { text: project.name.trim(), font: 'bold', size },
              ...(keywords ? [{ text: ` | ${keywords}`, font: 'italic' as const, size }] : []),
            ],
            { right: project.url?.trim() ? [{ text: shortUrl(project.url.trim()), font: 'regular', size: small, link: href(project.url.trim()) }] : [] },
          );
          const highlights = (project.highlights ?? []).filter((h) => h?.trim());
          // The parse sometimes puts the same sentence in both.
          if (project.description?.trim() && !highlights.some((h) => norm(h) === norm(project.description!))) {
            flow.write([{ text: project.description.trim(), font: 'regular', size }]);
          }
          bullets(highlights);
        });
        break;
      }
      case 'certificates': {
        const certificates = (resume.certificates ?? []).filter((c) => c.name?.trim());
        if (certificates.length === 0) break;
        heading(section.title);
        for (const certificate of certificates) {
          const issuer = certificate.issuer?.trim();
          flow.write(
            [
              { text: certificate.name.trim(), font: 'bold', size, ...(certificate.url?.trim() ? { link: href(certificate.url.trim()) } : {}) },
              ...(issuer ? [{ text: ` — ${issuer}`, font: 'regular' as const, size }] : []),
            ],
            { right: certificate.date ? [{ text: humanDate(certificate.date), font: 'regular', size }] : [] },
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
}

export async function renderResumePdf(resume: StructuredResume, options: { fit?: boolean } = {}): Promise<ResumePdf> {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);
  const layout = resolveLayout(resume);
  let flow = layoutResume(resume, layout, fonts, STEPS[0]!);
  if (options.fit !== false && flow.pages > 1) {
    for (const step of STEPS.slice(1)) {
      const tighter = layoutResume(resume, layout, fonts, step);
      if (tighter.pages === 1) {
        flow = tighter;
        break;
      }
    }
  }
  flow.draw(doc);
  const name = resume.basics?.name?.trim() || 'Résumé';
  doc.setTitle(`${name} – Résumé`);
  doc.setAuthor(name);
  doc.setCreator('JobOps Copilot');
  doc.setProducer('JobOps Copilot');
  // Classic cross-reference tables: every reader, old parsers included, opens them.
  return { pdf: Buffer.from(await doc.save({ useObjectStreams: false })), pages: flow.pages };
}

export async function renderAtsResumePdf(resume: StructuredResume): Promise<Buffer> {
  return (await renderResumePdf(resume)).pdf;
}
