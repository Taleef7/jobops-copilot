import type { StructuredResume } from '@/types';

/** A parsed field that looks wrong, for the user to fix or confirm before saving (#350). */
export interface ResumeFlag {
  /** Where it is, e.g. `work[0].company`. */
  path: string;
  value: string;
  /** Why it looks wrong, in words the confirmation screen shows as is. */
  reason: string;
}

// A number stuck to a word: "Encoded9", "roughly2,000". Text from a PDF that lost its spaces.
const NUMBER_STUCK = /[a-z]\d|\d[a-z]{2,}/i;
// A bracket stuck to a word: "Riccle(early-stage startup)".
const BRACKET_STUCK = /[a-z]\(/i;

/** A word for comparing: lower case, without digits or punctuation. */
const bare = (word: string) => word.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Checks each role's company and title. The parse once took the first word of a bullet
 * ("Encoded" in "Encoded 9 regulatory measures", read as "Encoded9") for the employer,
 * and that name then spread to the apply pack and the tailored PDF.
 */
export function flagResume(resume: StructuredResume): ResumeFlag[] {
  const flags: ResumeFlag[] = [];
  // The first word of every bullet in the résumé.
  const bulletStarts = new Set(
    resume.work.flatMap((role) => (role.highlights ?? []).map((line) => bare(line.trim().split(/\s+/)[0] ?? ''))),
  );
  bulletStarts.delete('');

  resume.work.forEach((role, index) => {
    const company = (role.company ?? '').trim();
    const path = `work[${index}].company`;
    if (!company) {
      flags.push({ path, value: company, reason: 'No company was found for this role.' });
    } else if (company.split(/\s+/).length <= 2 && bulletStarts.has(bare(company))) {
      flags.push({
        path,
        value: company,
        reason: `"${company}" looks like the first word of a bullet, not an employer.`,
      });
    } else if (NUMBER_STUCK.test(company)) {
      flags.push({ path, value: company, reason: `"${company}" has a number stuck to a word. Check the name.` });
    } else if (BRACKET_STUCK.test(company)) {
      flags.push({ path, value: company, reason: `"${company}" has a bracket stuck to a word. Check the name.` });
    }
    if (!(role.position ?? '').trim()) {
      flags.push({ path: `work[${index}].position`, value: '', reason: 'No title was found for this role.' });
    }
  });
  return flags;
}
