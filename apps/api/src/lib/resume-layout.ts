import type { ResumeLayout, ResumeSectionKey, ResumeVersionRecord, StructuredResume } from '@/types';

/**
 * The résumé's section order, titles and page size (#352), edited in Settings (#415); the PDF
 * reads them here. Sections the layout doesn't list keep their default order after the listed
 * ones, so nothing new is hidden by an older layout; `hidden` hides one.
 */

export const SECTION_KEYS: ResumeSectionKey[] = ['summary', 'work', 'education', 'skills', 'projects', 'certificates'];

export const DEFAULT_TITLES: Record<ResumeSectionKey, string> = {
  summary: 'Summary',
  work: 'Experience',
  education: 'Education',
  skills: 'Skills',
  projects: 'Projects',
  certificates: 'Certifications',
};

export interface ResolvedLayout {
  sections: Array<{ key: ResumeSectionKey; title: string }>;
  pageSize: 'letter' | 'a4';
}

export function resolveLayout(resume: Pick<StructuredResume, 'layout'>): ResolvedLayout {
  // As stored, a layout may hold anything: only known sections and real booleans count.
  const stored = normalizeLayout(resume.layout);
  const listed = stored?.sections ?? [];
  const seen = new Set<ResumeSectionKey>();
  const sections: ResolvedLayout['sections'] = [];
  for (const section of [...listed, ...SECTION_KEYS.map((key) => ({ key }))]) {
    if (!SECTION_KEYS.includes(section.key) || seen.has(section.key)) continue;
    seen.add(section.key);
    if ('hidden' in section && section.hidden) continue;
    const title = 'title' in section && typeof section.title === 'string' ? section.title.trim() : '';
    sections.push({ key: section.key, title: title || DEFAULT_TITLES[section.key] });
  }
  return { sections, pageSize: stored?.pageSize === 'a4' ? 'a4' : 'letter' };
}

/** A layout as stored: known sections and fields only. */
export function normalizeLayout(raw: unknown): ResumeLayout | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const sections = Array.isArray(obj.sections)
    ? obj.sections
        .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
        .filter((s) => SECTION_KEYS.includes(s.key as ResumeSectionKey))
        .map((s) => ({
          key: s.key as ResumeSectionKey,
          ...(typeof s.title === 'string' && s.title.trim() ? { title: s.title.trim().slice(0, 60) } : {}),
          ...(s.hidden === true ? { hidden: true } : {}),
        }))
    : undefined;
  const pageSize = obj.pageSize === 'a4' || obj.pageSize === 'letter' ? obj.pageSize : undefined;
  if (!sections && !pageSize) return undefined;
  return { ...(sections ? { sections } : {}), ...(pageSize ? { pageSize } : {}) };
}

export const SECTION_TITLE_MAX = 60;
// A heading is one line of plain text: no control, format or separator characters.
const NOT_PLAIN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const named = (value: unknown) => JSON.stringify(value)?.slice(0, 40) ?? String(value);

/**
 * A layout sent by the editor (#415), checked strictly: the fields sent, normalized (titles
 * trimmed, a blank title or `hidden: false` left out), or what is wrong with it. Only the
 * fields sent change, so a page size can be saved without the sections.
 */
export function parseLayoutPatch(raw: unknown): { layout: ResumeLayout } | { error: string } {
  if (!isObject(raw)) return { error: 'The layout must be an object.' };
  const unknown = Object.keys(raw).find((field) => field !== 'sections' && field !== 'pageSize');
  if (unknown !== undefined) return { error: `Unknown layout field: ${named(unknown)}.` };
  if (raw.sections === undefined && raw.pageSize === undefined) return { error: 'Send sections or pageSize.' };

  const layout: ResumeLayout = {};
  if (raw.sections !== undefined) {
    if (!Array.isArray(raw.sections)) return { error: 'sections must be a list.' };
    const seen = new Set<string>();
    const sections: NonNullable<ResumeLayout['sections']> = [];
    for (const section of raw.sections) {
      if (!isObject(section)) return { error: 'Each section must be an object with a key.' };
      const field = Object.keys(section).find((name) => name !== 'key' && name !== 'title' && name !== 'hidden');
      if (field !== undefined) return { error: `Unknown section field: ${named(field)}.` };
      const key = section.key as ResumeSectionKey;
      if (!SECTION_KEYS.includes(key)) {
        return { error: `Unknown section: ${named(section.key)}. The sections are ${SECTION_KEYS.join(', ')}.` };
      }
      if (seen.has(key)) return { error: `${key} is listed twice.` };
      seen.add(key);
      if (section.hidden !== undefined && typeof section.hidden !== 'boolean') return { error: 'hidden must be true or false.' };
      if (section.title !== undefined && typeof section.title !== 'string') return { error: 'A section title must be text.' };
      const title = typeof section.title === 'string' ? section.title.trim() : '';
      if (title.length > SECTION_TITLE_MAX) return { error: `A section title can be up to ${SECTION_TITLE_MAX} characters.` };
      if (NOT_PLAIN.test(title)) return { error: 'A section title must be one line of plain text.' };
      sections.push({ key, ...(title ? { title } : {}), ...(section.hidden === true ? { hidden: true } : {}) });
    }
    layout.sections = sections;
  }
  if (raw.pageSize !== undefined) {
    if (raw.pageSize !== 'letter' && raw.pageSize !== 'a4') return { error: 'pageSize must be letter or a4.' };
    layout.pageSize = raw.pageSize;
  }
  return { layout };
}

/**
 * Whether a version prints with its own layout (#415). A tailored draft follows the base
 * résumé's layout as it is now until it is downloaded or its job is marked applied; then the
 * layout copied onto it at that moment, so what was sent never changes.
 */
export function layoutFrozen(version: Pick<ResumeVersionRecord, 'isBase' | 'approved' | 'basedOn'>): boolean {
  return version.isBase || version.approved || Boolean(version.basedOn?.layoutFrozenAt);
}

/** `resume` with `layout` in place of its own; none (undefined) means the default. */
export function withLayout(resume: StructuredResume, layout: ResumeLayout | undefined): StructuredResume {
  const content = { ...resume };
  delete content.layout;
  return layout ? { ...content, layout } : content;
}

/** `resume` with the base résumé's layout (none means the default); without a base, as it is. */
export function withBaseLayout(resume: StructuredResume, base: Pick<StructuredResume, 'layout'> | null): StructuredResume {
  return base ? withLayout(resume, normalizeLayout(base.layout)) : resume;
}
