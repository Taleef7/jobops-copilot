import type { StructuredResume } from '@/types';

/**
 * The base résumé as the tailoring model sees it (#351): the lines it may reword, labelled by
 * path, and everything else as read-only facts. Only the summary and the work bullets are
 * editable; employers, titles, dates, education and contact details are never sent as
 * lines, so no edit can change them.
 */
export interface TailorLine {
  path: string;
  text: string;
  /** The role (work index) a bullet belongs to; null for the summary. */
  role: number | null;
}

const BULLET = /^work\[(0|[1-9]\d{0,2})\]\.highlights\[(0|[1-9]\d{0,2})\]$/;

/** The lines the model may reword: the summary and every bullet, blank ones left out. */
export function editableLines(resume: StructuredResume): TailorLine[] {
  const lines: TailorLine[] = [];
  if (resume.basics?.summary?.trim()) lines.push({ path: 'basics.summary', text: resume.basics.summary, role: null });
  (resume.work ?? []).forEach((role, i) => {
    (role.highlights ?? []).forEach((text, j) => {
      if (typeof text === 'string' && text.trim()) lines.push({ path: `work[${i}].highlights[${j}]`, text, role: i });
    });
  });
  return lines;
}

/** Replace the line at a path from `editableLines` (the only paths this is called with). */
export function setLine(resume: StructuredResume, path: string, text: string): void {
  if (path === 'basics.summary') {
    resume.basics.summary = text;
    return;
  }
  const match = BULLET.exec(path);
  const role = match ? resume.work[Number(match[1])] : undefined;
  if (!match || !role) throw new Error(`Not an editable line: ${path}`);
  role.highlights[Number(match[2])] = text;
}

function roleName(resume: StructuredResume, index: number): string {
  const role = resume.work[index];
  return role?.company?.trim() || role?.position?.trim() || `Role ${index + 1}`;
}

/** How a line's section is shown: "Summary", "Experience · Globex". */
export function sectionLabel(resume: StructuredResume, line: Pick<TailorLine, 'role'>): string {
  return line.role === null ? 'Summary' : `Experience · ${roleName(resume, line.role)}`;
}

export function roleLabel(resume: StructuredResume, index: number): string {
  return `Experience · ${roleName(resume, index)}`;
}

const dates = (start?: string, end?: string, current?: boolean) => {
  const to = current ? 'present' : end?.trim();
  return [start?.trim(), to].filter(Boolean).join(' – ');
};

/** The read-only facts, as plain text. Contact details are left out: tailoring never needs them. */
export function factsText(resume: StructuredResume): string {
  const out: string[] = [`Name: ${resume.basics.name}`];
  if (resume.basics.label?.trim()) out.push(`Headline: ${resume.basics.label.trim()}`);
  if (resume.work.length > 0) {
    out.push('Experience:');
    resume.work.forEach((role, i) => {
      const when = dates(role.startDate, role.endDate, role.current);
      const where = role.location?.trim() ? `, ${role.location.trim()}` : '';
      out.push(`- work[${i}]: ${role.position}, ${role.company}${when ? ` (${when})` : ''}${where}`);
      if (role.summary?.trim()) out.push(`  Role summary: ${role.summary.trim()}`);
    });
  }
  if (resume.education.length > 0) {
    out.push('Education:');
    for (const school of resume.education) {
      const degree = [school.studyType, school.area].filter((part) => part?.trim()).join(', ');
      const when = dates(school.startDate, school.endDate);
      out.push(`- ${[degree, school.institution].filter(Boolean).join(', ')}${when ? ` (${when})` : ''}${school.gpa ? `, GPA ${school.gpa}` : ''}`);
      for (const highlight of school.highlights ?? []) if (highlight.trim()) out.push(`  - ${highlight.trim()}`);
    }
  }
  if (resume.projects?.length) {
    out.push('Projects:');
    for (const project of resume.projects) {
      const keywords = project.keywords?.length ? ` (${project.keywords.join(', ')})` : '';
      out.push(`- ${project.name}${project.description?.trim() ? `: ${project.description.trim()}` : ''}${keywords}`);
      for (const highlight of project.highlights ?? []) if (highlight.trim()) out.push(`  - ${highlight.trim()}`);
    }
  }
  if (resume.certificates?.length) {
    out.push('Certificates:');
    for (const cert of resume.certificates) {
      out.push(`- ${[cert.name, cert.issuer].filter(Boolean).join(', ')}${cert.date ? ` (${cert.date})` : ''}`);
    }
  }
  return out.join('\n');
}

/** One role's own text: the evidence for the tools a bullet of that role may name. */
export function roleText(resume: StructuredResume, index: number): string {
  const role = resume.work[index];
  if (!role) return '';
  return [role.position, role.company, role.location, role.summary, ...(role.highlights ?? [])]
    .filter((part): part is string => typeof part === 'string')
    .join('\n');
}

/** Every word of the résumé: the evidence for the summary, which may draw on all of it. */
export function wholeText(resume: StructuredResume): string {
  const parts: Array<string | undefined> = [resume.basics.label, resume.basics.summary];
  resume.work.forEach((_role, i) => parts.push(roleText(resume, i)));
  for (const school of resume.education) {
    parts.push(school.institution, school.studyType, school.area, ...(school.highlights ?? []));
  }
  for (const group of resume.skills) parts.push(group.category, ...group.skills);
  for (const project of resume.projects ?? []) {
    parts.push(project.name, project.description, ...(project.highlights ?? []), ...(project.keywords ?? []));
  }
  for (const cert of resume.certificates ?? []) parts.push(cert.name, cert.issuer);
  return parts.filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join('\n');
}

/** Every skill, in order. */
export function flatSkills(resume: StructuredResume): string[] {
  return resume.skills.flatMap((group) => group.skills);
}
