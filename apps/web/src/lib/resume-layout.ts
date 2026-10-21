import type { ResumeLayout, ResumeSectionKey } from '@/types/job';

/**
 * The PDF's sections (#415), as the API has them (apps/api/src/lib/resume-layout.ts): their
 * default order and headings. A layout lists them in the user's order; one it doesn't list
 * keeps its default place after the listed ones.
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

export const SECTION_TITLE_MAX = 60;

export interface LayoutRow {
  key: ResumeSectionKey;
  /** The user's heading; empty for the default one. */
  title: string;
  hidden: boolean;
}

/** Every section in print order, hidden ones too, as the API resolves the layout. */
export function layoutRows(layout: ResumeLayout | undefined): LayoutRow[] {
  const seen = new Set<ResumeSectionKey>();
  const rows: LayoutRow[] = [];
  for (const section of [...(layout?.sections ?? []), ...SECTION_KEYS.map((key) => ({ key, title: undefined, hidden: undefined }))]) {
    if (!SECTION_KEYS.includes(section.key) || seen.has(section.key)) continue;
    seen.add(section.key);
    rows.push({ key: section.key, title: section.title?.trim() ?? '', hidden: section.hidden === true });
  }
  return rows;
}

/** The heading a row prints with. */
export const headingOf = (row: LayoutRow) => row.title || DEFAULT_TITLES[row.key];

/** Rows as the API stores them: a title only when it isn't the default, `hidden` only when set. */
export function rowsToSections(rows: LayoutRow[]): NonNullable<ResumeLayout['sections']> {
  return rows.map(({ key, title, hidden }) => ({
    key,
    ...(title && title !== DEFAULT_TITLES[key] ? { title } : {}),
    ...(hidden ? { hidden: true } : {}),
  }));
}

/** `list` with the item at `from` moved to `to`. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}
