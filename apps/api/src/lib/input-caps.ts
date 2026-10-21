/**
 * Size limits on user text (#345). Stored text has a hard ceiling, and what reaches the
 * LLM is cut shorter still: the budget used to charge a flat cent per call however long
 * the posting or résumé was.
 */

/** The most job text sent to the LLM in one call. */
export const LLM_JOB_TEXT_MAX = 20_000;
/** The most résumé or profile text sent to the LLM in one call. */
export const LLM_PROFILE_TEXT_MAX = 15_000;
/** The longest posting, résumé or profile text that is stored at all. */
export const STORED_TEXT_MAX = 100_000;
/** Short fields on a job. */
export const JOB_FIELD_MAX = 300;
export const JOB_NOTE_MAX = 10_000;

export const TOO_LONG_MESSAGE = `This text is too long. The limit is ${STORED_TEXT_MAX.toLocaleString('en-US')} characters.`;

const FIELD_CAPS: Record<string, number> = {
  description_text: LLM_JOB_TEXT_MAX,
  job_description: LLM_JOB_TEXT_MAX,
  description: LLM_JOB_TEXT_MAX,
  job_context: LLM_JOB_TEXT_MAX,
  context: LLM_JOB_TEXT_MAX, // the research agent's job description
  resume_text: LLM_PROFILE_TEXT_MAX,
  profile_text: LLM_PROFILE_TEXT_MAX,
  resume_summary: LLM_PROFILE_TEXT_MAX,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A structured résumé's limits (#352): a field (a summary, a bullet), a list (roles, bullets,
 * skills) and all its text together. A real résumé is under 20,000 characters. Its PDF is drawn
 * on the request, so one the size of a book would hold the server up.
 */
export const RESUME_FIELD_MAX = 5_000;
export const RESUME_LIST_MAX = 200;
export const RESUME_TEXT_MAX = 60_000;

/** A résumé too big to save or draw: 413. */
export class ResumeTooLargeError extends Error {
  constructor(message = `This résumé is too long (the limit is ${RESUME_TEXT_MAX.toLocaleString('en-US')} characters in all).`) {
    super(message);
    this.name = 'ResumeTooLargeError';
  }
}

/**
 * The résumé without its layout (#415): the layout isn't résumé text, and its own check bounds
 * it (six sections, headings of 60 characters). Counting it would refuse a résumé near the cap
 * once a heading is renamed.
 */
const content = (value: unknown): unknown => (isPlainObject(value) && 'layout' in value ? { ...value, layout: undefined } : value);

/** All the text in a structured résumé, in characters. */
export function resumeTextLength(value: unknown, depth = 0): number {
  if (depth === 0) value = content(value);
  if (depth > 6) return 0;
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + resumeTextLength(item, depth + 1), 0);
  if (isPlainObject(value)) return Object.values(value).reduce<number>((sum, field) => sum + resumeTextLength(field, depth + 1), 0);
  return 0;
}

/** What makes a structured résumé too big, in words a user can act on; null when it isn't. */
export function resumeProblem(value: unknown): string | null {
  const walk = (node: unknown, where: string, depth: number): string | null => {
    if (depth > 6) return null;
    if (typeof node === 'string') {
      return node.length > RESUME_FIELD_MAX
        ? `${where} is longer than ${RESUME_FIELD_MAX.toLocaleString('en-US')} characters. Shorten it and save again.`
        : null;
    }
    if (Array.isArray(node)) {
      if (node.length > RESUME_LIST_MAX) return `${where} has more than ${RESUME_LIST_MAX} entries. Remove some and save again.`;
      for (const item of node) {
        const problem = walk(item, where, depth + 1);
        if (problem) return problem;
      }
      return null;
    }
    if (isPlainObject(node)) {
      for (const [key, field] of Object.entries(node)) {
        const problem = walk(field, RESUME_PART_NAMES[key] ?? where, depth + 1);
        if (problem) return problem;
      }
    }
    return null;
  };
  const problem = walk(content(value), 'A field of this résumé', 0);
  if (problem) return problem;
  return resumeTextLength(value) > RESUME_TEXT_MAX ? new ResumeTooLargeError().message : null;
}

const RESUME_PART_NAMES: Record<string, string> = {
  summary: 'The summary',
  highlights: 'A bullet',
  skills: 'A skill list',
  work: 'Experience',
  education: 'Education',
  projects: 'Projects',
  certificates: 'Certifications',
  description: 'A description',
};

/** Whether a structured résumé holds more than a résumé does. */
export function resumeTooLarge(value: unknown): boolean {
  return resumeProblem(value) !== null;
}

// Specialist payloads nest the job (`input.job.description_text`), sometimes in arrays.
const MAX_DEPTH = 4;

function capValue(value: unknown, depth: number): { value: unknown; truncated: boolean } {
  if (depth > MAX_DEPTH) return { value, truncated: false };
  if (Array.isArray(value)) {
    let truncated = false;
    const items = value.map((item) => {
      const capped = capValue(item, depth + 1);
      truncated ||= capped.truncated;
      return capped.value;
    });
    return { value: items, truncated };
  }
  if (!isPlainObject(value)) return { value, truncated: false };
  let truncated = false;
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    const cap = FIELD_CAPS[key];
    if (cap !== undefined && typeof field === 'string' && field.length > cap) {
      result[key] = field.slice(0, cap);
      truncated = true;
    } else {
      const nested = capValue(field, depth + 1);
      result[key] = nested.value;
      truncated ||= nested.truncated;
    }
  }
  return { value: result, truncated };
}

/**
 * Cut the known text fields of an agent request to their LLM limits, wherever they sit in
 * nested objects and arrays (up to a few levels). Other fields are untouched.
 */
export function capAgentPayload(payload: unknown): { payload: unknown; truncated: boolean } {
  const { value, truncated } = capValue(payload, 0);
  return truncated ? { payload: value, truncated } : { payload, truncated: false };
}

/** True when a string is longer than `max` characters. */
export function isTooLong(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.length > max;
}
