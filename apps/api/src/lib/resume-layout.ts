import type { ResumeLayout, ResumeSectionKey, StructuredResume } from '@/types';

/**
 * The résumé's section order, titles and page size (#352). Editing them comes with #415; the
 * PDF reads them here. Sections the layout doesn't list keep their default order after the
 * listed ones, so nothing new is hidden by an older layout; `hidden` hides one.
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
  const listed = Array.isArray(resume.layout?.sections) ? resume.layout.sections : [];
  const seen = new Set<ResumeSectionKey>();
  const sections: ResolvedLayout['sections'] = [];
  for (const section of [...listed, ...SECTION_KEYS.map((key) => ({ key }))]) {
    if (!SECTION_KEYS.includes(section.key) || seen.has(section.key)) continue;
    seen.add(section.key);
    if ('hidden' in section && section.hidden) continue;
    const title = 'title' in section && typeof section.title === 'string' ? section.title.trim() : '';
    sections.push({ key: section.key, title: title || DEFAULT_TITLES[section.key] });
  }
  return { sections, pageSize: resume.layout?.pageSize === 'a4' ? 'a4' : 'letter' };
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
