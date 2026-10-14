import { isDeepStrictEqual } from 'node:util';
import type { GroundingIssue, ResumeChangeDetail, ResumeVersionRecord, StructuredResume } from '@/types';
import type { TailorAnswer } from './answer';
import { BLOCKING, checkLine, prepareEvidence } from './ground';
import { editableLines, flatSkills, roleLabel, sectionLabel, setLine, wholeText, type TailorLine } from './lines';
import { buildVocab, termsIn } from './terms';
import { contentTokens, norm, wordStems } from './text';

/**
 * Apply the model's edits to the base résumé, checking each one (#351). The model never
 * returns a résumé: the API copies the base and changes only the lines, orders and skills
 * that pass the check, so employers, titles, dates, education and contact details can't
 * change. A suggestion that fails is dropped (the base line stays) and shown as dropped.
 */

/** Set on a version by this check; approve and download require it. */
export const GROUNDING_VERSION = 1;

export function isGrounded(version: Pick<ResumeVersionRecord, 'basedOn'>): boolean {
  return version.basedOn?.grounding?.version === GROUNDING_VERSION;
}

export interface TailorContext {
  /** The posting's company. */
  company: string;
  /** The posting's keywords from the fit read. */
  jobTerms: string[];
  /** Keywords the user confirmed having in the tailor window. */
  confirmedKeywords: string[];
  /** The lines the model was sent; an edit to any other line is invalid. Default: every line. */
  sentPaths?: string[];
}

export interface TailorResult {
  resume: StructuredResume;
  details: ResumeChangeDetail[];
  /** Posting requirements the résumé doesn't support, minus any it or the user covers. */
  gaps: string[];
  /** Written from what was applied; the model's own summary is not used. */
  changeSummary: string;
  /**
   * How many of the model's suggestions produced a detail, applied or dropped. The API's own
   * additions of confirmed keywords don't count: zero means the AI suggested nothing.
   */
  suggested: number;
}

const MAX_GAPS = 15;
const MAX_GAP_LENGTH = 160;
/** More edits than any résumé needs; the rest of a runaway answer is ignored. */
const MAX_EDITS = 50;

/**
 * A bullet is one line: no line breaks or leading bullet glyph. The summary keeps its line
 * breaks only if the base summary has some, so a suggestion can't add a fake section.
 */
function cleanText(text: string, line: TailorLine): string {
  const trimmed = text.trim();
  if (line.role === null && line.text.includes('\n')) return trimmed;
  return trimmed.replace(/^[•·▪●◦*-]\s*/, '').replace(/\s+/g, ' ');
}

/** The line an edit is for: its path, unless its old text is exactly one other line (an index slip). */
function lineFor(edit: TailorAnswer['edits'][number], lines: TailorLine[]): TailorLine | null {
  const atPath = lines.find((line) => line.path === edit.source_path) ?? null;
  const quoted = norm(edit.old_text);
  if (atPath && norm(atPath.text) === quoted) return atPath;
  const matches = quoted ? lines.filter((line) => norm(line.text) === quoted) : [];
  if (matches.length === 1) return matches[0]!;
  // The path is a real line and the quote is off: the check runs against the real line.
  return atPath;
}

function dropReason(issues: GroundingIssue[]): string | undefined {
  return issues.find((issue) => BLOCKING.has(issue.code))?.message;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function listPhrase(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The skill group an added keyword goes in. Creates "Skills" or "Other" when needed. */
function skillGroup(resume: StructuredResume, wanted: string | undefined): StructuredResume['skills'][number] {
  const byName = (name: string) => resume.skills.find((group) => norm(group.category) === norm(name));
  const chosen = wanted ? byName(wanted) : undefined;
  if (chosen) return chosen;
  if (resume.skills.length === 1) return resume.skills[0]!;
  const name = resume.skills.length === 0 ? 'Skills' : 'Other';
  const existing = byName(name);
  if (existing) return existing;
  const created = { category: name, skills: [] as string[] };
  resume.skills.push(created);
  return created;
}

/** A requirement the résumé can't show by naming the tool: years, seniority, leading people. */
const QUALIFIER = /\d|\byears?\b|\bsenior|\blead(ing|s)?\b|\bmanag(e|es|ed|ing)\b/i;

/** Words a requirement is phrased with, which say nothing about what is required. */
const GAP_FILLER = new Set(
  contentTokens(
    'experience knowledge proficiency proficient skills expertise familiarity understanding background advanced ' +
      'strong solid deep hands working practical exposure ability demonstrated proven track record plus preferred ' +
      'required nice good excellent',
  ),
);

/**
 * Gaps the base résumé or the user's confirmed keywords already cover are left out: every
 * word of the gap, apart from words like "advanced" or "experience", is already there
 * ("Advanced SQL experience" when SQL is a skill). A gap that asks for years, seniority or
 * leading people stays.
 */
function openGaps(gaps: string[], base: StructuredResume, confirmed: string[]): string[] {
  const known = wordStems(`${wholeText(base)}\n${confirmed.join('\n')}`);
  const seen = new Set<string>();
  const open: string[] = [];
  for (const raw of gaps) {
    const gap = raw.trim().slice(0, MAX_GAP_LENGTH);
    if (!gap || seen.has(norm(gap))) continue;
    seen.add(norm(gap));
    const words = contentTokens(gap).filter((word) => !GAP_FILLER.has(word));
    const isCovered = !QUALIFIER.test(gap) && words.length > 0 && words.every((word) => known.has(word));
    if (!isCovered) open.push(gap);
    if (open.length === MAX_GAPS) break;
  }
  return open;
}

/** A bug in this file must not change a fact; this throws (500) rather than save one. */
export function assertFactsUnchanged(base: StructuredResume, tailored: StructuredResume): void {
  const problems: string[] = [];
  const withoutSummary = (resume: StructuredResume) => ({ ...resume.basics, summary: '' });
  if (!isDeepStrictEqual(withoutSummary(base), withoutSummary(tailored))) problems.push('basics');
  if (base.work.length !== tailored.work.length) problems.push('work');
  base.work.forEach((role, i) => {
    const other = tailored.work[i];
    const { highlights: baseBullets, ...baseRole } = role;
    if (!other) return;
    const { highlights: tailoredBullets, ...tailoredRole } = other;
    if (!isDeepStrictEqual(baseRole, tailoredRole) || baseBullets.length !== tailoredBullets.length) problems.push(`work[${i}]`);
  });
  for (const key of ['education', 'projects', 'certificates'] as const) {
    if (!isDeepStrictEqual(base[key], tailored[key])) problems.push(key);
  }
  // By position: two groups may share a name. Added keywords may extend a group or add one.
  base.skills.forEach((group, i) => {
    const other = tailored.skills[i];
    if (!other || other.category !== group.category || group.skills.some((skill) => !other.skills.includes(skill))) {
      problems.push(`skills[${i}]`);
    }
  });
  if (problems.length > 0) throw new Error(`Tailoring changed a fact of the base résumé: ${problems.join(', ')}`);
}

export function tailorFromAnswer(base: StructuredResume, answer: TailorAnswer, ctx: TailorContext): TailorResult {
  const resume = structuredClone(base);
  const sent = ctx.sentPaths ? new Set(ctx.sentPaths) : null;
  const lines = editableLines(base).filter((line) => !sent || sent.has(line.path));
  const confirmed = ctx.confirmedKeywords;
  const vocab = buildVocab([
    ...flatSkills(base),
    ...(base.projects ?? []).flatMap((project) => project.keywords ?? []),
    ...ctx.jobTerms,
    ...confirmed,
  ]);
  const evidence = prepareEvidence(base, vocab, confirmed);
  const check = { base, vocab, company: ctx.company, confirmedKeywords: confirmed, evidence };
  const details: ResumeChangeDetail[] = [];
  const counts = { reworded: 0, roles: 0, skillsReordered: false, added: 0, dropped: 0 };

  // Rewordings.
  const done = new Set<string>();
  for (const edit of answer.edits.slice(0, MAX_EDITS)) {
    const line = lineFor(edit, lines);
    if (!line) {
      details.push({
        kind: 'rewrite',
        section: 'Résumé',
        sourcePath: null,
        oldText: null,
        newText: edit.new_text.trim(),
        rationale: edit.rationale,
        dropped: true,
        dropReason: "doesn't match a line of your base résumé",
        issues: [{ code: 'INVALID_PATH', message: "doesn't match a line of your base résumé" }],
        needsReview: false,
      });
      counts.dropped += 1;
      continue;
    }
    if (done.has(line.path)) continue;
    done.add(line.path);
    const newText = cleanText(edit.new_text, line);
    if (norm(newText) === norm(line.text)) continue;
    const { issues, confirmedTerms } = newText
      ? checkLine(line, newText, check)
      : { issues: [{ code: 'EMPTY_LINE' as const, message: 'would remove the line' }], confirmedTerms: [] };
    const reason = dropReason(issues);
    if (reason) counts.dropped += 1;
    else {
      setLine(resume, line.path, newText);
      counts.reworded += 1;
    }
    details.push({
      kind: 'rewrite',
      section: sectionLabel(base, line),
      sourcePath: line.path,
      oldText: line.text,
      newText,
      rationale: edit.rationale,
      dropped: Boolean(reason),
      ...(reason ? { dropReason: reason } : {}),
      issues,
      needsReview: !reason && (issues.length > 0 || confirmedTerms.length > 0),
      ...(confirmedTerms.length > 0 ? { confirmedTerms } : {}),
    });
  }

  // Bullet order within a role: only a full reordering of its bullets.
  const ordered = new Set<number>();
  for (const { work_index: index, highlight_order: order } of answer.highlight_orders) {
    const role = resume.work[index];
    if (!role || ordered.has(index)) continue;
    ordered.add(index);
    const n = role.highlights.length;
    const isPermutation = order.length === n && new Set(order).size === n && order.every((i) => i >= 0 && i < n);
    if (!isPermutation || order.every((i, position) => i === position)) continue;
    const current = [...role.highlights];
    role.highlights = order.map((i) => current[i]!);
    counts.roles += 1;
    details.push({
      kind: 'reorder',
      section: roleLabel(base, index),
      sourcePath: `work[${index}].highlights`,
      // The base résumé's bullets in their order; the new order shows any rewording.
      oldText: base.work[index]!.highlights.join('\n'),
      newText: role.highlights.join('\n'),
      rationale: 'The bullets most relevant to the posting come first.',
      dropped: false,
      issues: [],
      needsReview: false,
    });
  }

  // Skill order within each group: only an exact reordering of every skill.
  const skills = flatSkills(base);
  const rank = new Map<string, number>();
  answer.skills_order.forEach((skill, i) => {
    if (!rank.has(norm(skill))) rank.set(norm(skill), i);
  });
  const sameSkills =
    answer.skills_order.length === skills.length &&
    rank.size === new Set(skills.map(norm)).size &&
    skills.every((skill) => rank.has(norm(skill)));
  if (sameSkills) {
    for (const group of resume.skills) {
      group.skills = [...group.skills].sort((a, b) => rank.get(norm(a))! - rank.get(norm(b))!);
    }
    const after = flatSkills(resume);
    if (!isDeepStrictEqual(after, skills)) {
      counts.skillsReordered = true;
      details.push({
        kind: 'skills-reorder',
        section: 'Skills',
        sourcePath: 'skills',
        oldText: skills.join(', '),
        newText: after.join(', '),
        rationale: 'The skills most relevant to the posting come first.',
        dropped: false,
        issues: [],
        needsReview: false,
      });
    }
  }

  // Confirmed keywords join the skills, under the group the model chose when the résumé has it.
  // A skill by another name ("Postgres" for PostgreSQL) is already there.
  const isSkill = (term: string) => {
    const current = flatSkills(resume);
    if (current.some((skill) => norm(skill) === norm(term))) return true;
    // Not counting a cloud's services as the cloud: confirming "AWS" over "EC2, S3" adds it.
    const keys = termsIn(term, vocab, { evidence: true, parts: false });
    const skillKeys = new Set(termsIn(current.join('\n'), vocab, { evidence: true, parts: false }));
    return keys.length > 0 && keys.every((key) => skillKeys.has(key));
  };
  const seen = new Set<string>();
  for (const keyword of confirmed) {
    if (seen.has(norm(keyword)) || isSkill(keyword)) continue;
    seen.add(norm(keyword));
    const placed = answer.added_skills.find((added) => norm(added.skill) === norm(keyword));
    const group = skillGroup(resume, placed?.category);
    group.skills.push(keyword);
    counts.added += 1;
    details.push({
      kind: 'skill-added',
      section: `Skills · ${group.category}`,
      sourcePath: null,
      oldText: null,
      newText: keyword,
      rationale: `You confirmed you have ${keyword}.`,
      dropped: false,
      issues: [],
      needsReview: false,
      confirmedTerms: [keyword],
    });
  }
  for (const added of answer.added_skills) {
    const skill = added.skill.trim();
    if (!skill || confirmed.some((keyword) => norm(keyword) === norm(skill)) || isSkill(skill)) continue;
    const message = `adds ${skill}, which isn't in your base résumé and you didn't confirm`;
    counts.dropped += 1;
    details.push({
      kind: 'skill-added',
      section: 'Skills',
      sourcePath: null,
      oldText: null,
      newText: skill,
      rationale: 'The model suggested adding this skill.',
      dropped: true,
      dropReason: message,
      issues: [{ code: 'NEW_SKILL', term: skill, message }],
      needsReview: false,
    });
  }

  assertFactsUnchanged(base, resume);

  const applied = [
    counts.reworded > 0 ? `reworded ${plural(counts.reworded, 'line')}` : '',
    counts.roles > 0 ? `reordered bullets in ${plural(counts.roles, 'role')}` : '',
    counts.skillsReordered ? 'reordered skills' : '',
    counts.added > 0 ? `added ${plural(counts.added, 'skill')} you confirmed` : '',
  ].filter(Boolean);
  const first = applied.length > 0 ? listPhrase(applied) : 'no changes were applied';
  const droppedNote =
    counts.dropped > 0 ? ` ${plural(counts.dropped, 'suggestion')} ${counts.dropped === 1 ? 'was' : 'were'} dropped.` : '';
  const changeSummary = `${first.charAt(0).toUpperCase()}${first.slice(1)}.${droppedNote}`;

  return {
    resume,
    details: details.map((detail, i) => ({ id: `c${i}`, ...detail })),
    gaps: openGaps(answer.gaps, base, confirmed),
    changeSummary,
    suggested: details.filter((detail) => !(detail.kind === 'skill-added' && !detail.dropped)).length,
  };
}
